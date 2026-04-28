import { Handle, shallowArrayEquals } from "./handle";

/**
 * Schema-indexed scope tree backing the `closestView` / `ancestorView`
 * / `childViews` lookups exposed on every mounted view element.
 *
 * Each mounted view owns one `Scope`. The scope tree mirrors the *view*
 * tree (plain DOM is transparent — only view elements get a scope), and
 * every scope optionally carries a `Handle` whose value is matched
 * against schemas registered through `closest` / `findChildren`.
 *
 * The tree shares one `Engine` per root: the registered-schema set (so
 * registration is idempotent and back-fill walks every scope exactly
 * once) and the all-scopes set. `new Scope()` is its own root engine;
 * `parent.create()` re-points the child at the parent's engine.
 */

export type Schema<T = unknown> = {
  init?(): T;
  parse(value: unknown): T;
};

type Engine = {
  schemas: Set<Schema>;
  scopes: Set<Scope>;
};

export class Scope {
  parent: Scope | null = null;

  // Engine state shared across every scope in the tree. `create`
  // re-points the new child at the parent's engine; `moveTo` enforces
  // that both sides share the same engine.
  #engine: Engine;
  #children: Scope[] = [];

  #handle: Handle<unknown> | null = null;
  #unsubHandle: (() => void) | null = null;

  // `#ownMatches.has(schema)` ⇔ `schema.parse(handle.value())` succeeded.
  #ownMatches = new Map<Schema, true>();

  #closestViews = new Map<Schema, Handle<Scope | null>>();
  #findChildrenViews = new Map<Schema, Handle<readonly Scope[]>>();

  constructor() {
    this.#engine = { schemas: new Set(), scopes: new Set() };
    this.#engine.scopes.add(this);
  }

  get children(): readonly Scope[] {
    return this.#children;
  }

  get handle(): Handle<unknown> | null {
    return this.#handle;
  }

  /**
   * Attaching a handle: subscribe to its `change` stream so future
   * `change(next)` calls flow back into our own-match recompute, and
   * fire the initial parse manually since `Handle.on` (unlike a
   * `subscribe`-style API) does not auto-fire with the current value.
   *
   * Detaching (set to null): unsubscribe and re-run the recompute,
   * which now sees `this.#handle === null` and clears every match.
   */
  set handle(next: Handle<unknown> | null) {
    if (next === this.#handle) return;
    this.#unsubHandle?.();
    this.#unsubHandle = null;
    this.#handle = next;
    if (next) {
      const listener = () => this.#onHandleValueChange();
      next.on("change", listener);
      this.#unsubHandle = () => next.off("change", listener);
      this.#onHandleValueChange();
    } else {
      this.#onHandleValueChange();
    }
  }

  /**
   * Create and append a fresh child scope. The optional `handle` is
   * applied via the `handle` setter, so the same wiring (subscribe,
   * initial parse, view propagation) runs whether the child was created
   * with or without one.
   */
  create(handle?: Handle<unknown>): Scope {
    const child = new Scope();
    child.#engine.scopes.delete(child);
    child.#engine = this.#engine;
    child.#engine.scopes.add(child);
    child.parent = this;
    this.#children.push(child);

    if (handle) child.handle = handle;

    // Structural invalidation. Redundant with the handle-attach
    // invalidation when `handle` was passed (`Object.is` /
    // shallow-array dedup absorbs the duplicate fire), but covers the
    // no-handle case where a parent's `findChildren` still needs to
    // settle.
    for (const s of this.#engine.schemas) {
      Scope.#invalidateClosestSubtree(child, s);
      Scope.#invalidateFindChildren(this, s);
    }
    return child;
  }

  /**
   * Reparent this scope under `newParent`. Cycles and cross-tree moves
   * throw — both are programmer errors with no sensible recovery.
   */
  moveTo(newParent: Scope): void {
    if (newParent.#engine !== this.#engine) {
      throw new Error("scope: cannot move scope across trees");
    }
    if (newParent === this || Scope.#isAncestorOf(this, newParent)) {
      throw new Error("scope: cannot move into itself or a descendant");
    }
    const oldParent = this.parent;
    this.remove();
    this.parent = newParent;
    newParent.#children.push(this);
    for (const s of this.#engine.schemas) {
      Scope.#invalidateClosestSubtree(this, s);
      if (oldParent) Scope.#invalidateFindChildren(oldParent, s);
      Scope.#invalidateFindChildren(newParent, s);
    }
  }

  /** `Element.remove()` analog. No-op at the root. */
  remove(): void {
    const oldParent = this.parent;
    if (!oldParent) return;
    const idx = oldParent.#children.indexOf(this);
    if (idx >= 0) oldParent.#children.splice(idx, 1);
    this.parent = null;
    for (const s of this.#engine.schemas) {
      Scope.#invalidateClosestSubtree(this, s);
      Scope.#invalidateFindChildren(oldParent, s);
    }
  }

  closest<T>(schema: Schema<T>): Handle<Scope | null> {
    this.#registerSchema(schema);
    let view = this.#closestViews.get(schema);
    if (view) return view;
    view = new Handle<Scope | null>(Scope.#computeClosest(this, schema));
    this.#closestViews.set(schema, view);
    return view;
  }

  findChildren<T>(schema: Schema<T>): Handle<readonly Scope[]> {
    this.#registerSchema(schema);
    let view = this.#findChildrenViews.get(schema);
    if (view) return view;
    view = new Handle<readonly Scope[]>(
      Scope.#computeFindChildren(this, schema),
      shallowArrayEquals,
    );
    this.#findChildrenViews.set(schema, view);
    return view;
  }

  /**
   * Run by the handle's `change` listener (and by the setter when
   * `handle` is cleared to null). Re-parses every registered schema
   * against the current value and fans out any flips.
   */
  #onHandleValueChange(): void {
    for (const schema of this.#engine.schemas) {
      if (!this.#recomputeOwnMatch(schema)) continue;
      Scope.#invalidateClosestSubtree(this, schema);
      if (this.parent) Scope.#invalidateFindChildren(this.parent, schema);
    }
  }

  #recomputeOwnMatch(schema: Schema): boolean {
    const matched = this.#tryParse(schema);
    const had = this.#ownMatches.has(schema);
    if (matched === had) return false;
    if (matched) this.#ownMatches.set(schema, true);
    else this.#ownMatches.delete(schema);
    return true;
  }

  #tryParse(schema: Schema): boolean {
    if (!this.#handle) return false;
    try {
      schema.parse(this.#handle.value());
      return true;
    } catch {
      return false;
    }
  }

  #registerSchema(schema: Schema): void {
    if (this.#engine.schemas.has(schema)) return;
    this.#engine.schemas.add(schema);
    for (const scope of this.#engine.scopes) {
      scope.#recomputeOwnMatch(schema);
    }
  }

  static #isAncestorOf(maybeAncestor: Scope, of: Scope): boolean {
    let cur: Scope | null = of;
    while (cur) {
      if (cur === maybeAncestor) return true;
      cur = cur.parent;
    }
    return false;
  }

  /**
   * Walk `scope` and every descendant, recomputing the `closest` view
   * for `schema` if it has been materialised. Used after any change
   * that could move the answer for descendants whose nearest match
   * crossed (or now crosses) `scope`.
   */
  static #invalidateClosestSubtree(scope: Scope, schema: Schema): void {
    const view = scope.#closestViews.get(schema);
    if (view) view.change(Scope.#computeClosest(scope, schema));
    for (const child of scope.#children) {
      Scope.#invalidateClosestSubtree(child, schema);
    }
  }

  /**
   * Recompute `parent`'s materialised `findChildren` view for `schema`,
   * if any. Direct-children-only, so invalidation only ever fires on
   * the immediate parent; no upward walk required.
   */
  static #invalidateFindChildren(parent: Scope, schema: Schema): void {
    const view = parent.#findChildrenViews.get(schema);
    if (view) view.change(Scope.#computeFindChildren(parent, schema));
  }

  static #computeClosest(scope: Scope, schema: Schema): Scope | null {
    let cur: Scope | null = scope;
    while (cur) {
      if (cur.#ownMatches.has(schema)) return cur;
      cur = cur.parent;
    }
    return null;
  }

  static #computeFindChildren(scope: Scope, schema: Schema): Scope[] {
    return scope.#children.filter((c) => c.#ownMatches.has(schema));
  }
}
