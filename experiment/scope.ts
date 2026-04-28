import {
  BasicSubscribable,
  shallowArrayEquals,
  type Subscribable,
} from "./subscribable";

/**
 * Duck-typed schema. Mirrors the framework's `Schema<T>` so prototype
 * code reads identically to a real component. `init` is unused here and
 * kept optional; the prototype only ever calls `parse`.
 */
export type Schema<T = unknown> = {
  init?(): T;
  parse(value: unknown): T;
};

/**
 * Minimal handle interface the prototype operates on. Same shape as
 * `BasicSubscribable<T>`, so a test can pass a `BasicSubscribable`
 * directly. A real `DocHandle` would need a thin adapter — its API
 * uses `doc()` and `on("change", …)` instead of `value()` /
 * `subscribe`.
 *
 * `subscribe(fn)` is required to fire `fn` synchronously with the
 * current value on attach; that initial fire drives the first schema
 * parse and is what wires `#ownMatches` up when a handle is set.
 */
export type Handle<T = unknown> = {
  value(): T;
  change(next: T): void;
  subscribe(fn: (value: T) => void): () => void;
};

/**
 * Tree-wide bookkeeping. One `Engine` per tree; every `Scope` in the
 * tree shares it via `#engine`. Holds the registered-schema set (so
 * registration is idempotent and back-fill walks every scope exactly
 * once) and the all-scopes set (the back-fill traversal target).
 */
type Engine = {
  schemas: Set<Schema>;
  scopes: Set<Scope>;
};

/**
 * One node in the schema-indexed lookup tree. Roughly analogous to a
 * single mounted component element in `src/components/`: each `Scope`
 * carries an optional `handle` (analog of `el.handle`) and exposes
 * two schema-keyed views that work like DOM lookups:
 *
 * - `closest(s)` — `Element.closest(selector)` analog: the nearest
 *   match walking self → parent → root.
 * - `findAll(s)` — `Element.querySelectorAll(selector)` analog: every
 *   match anywhere in this scope's subtree.
 *
 * Both derive from one source of truth: each scope's per-schema
 * `#ownMatches` slot, set when `handle.value()` parses under the
 * schema. Mutators (`create`, `moveTo`, `remove`, `handle = …`,
 * `handle.change(...)`) invalidate exactly the subset of materialised
 * views whose answer might have moved.
 *
 * Schemas register lazily on first lookup and are tree-wide: registering
 * walks every live scope once and back-fills `#ownMatches`.
 */
export class Scope {
  parent: Scope | null = null;

  // Engine state shared across every scope in the tree. The root creates
  // a fresh engine; `create` re-points the new child at the parent's
  // engine. `moveTo` enforces that both sides share the same engine.
  #engine: Engine;
  #children: Scope[] = [];

  #handle: Handle | null = null;
  #unsubHandle: (() => void) | null = null;

  // `#ownMatches.has(schema)` ⇔ `schema.parse(handle.value())` succeeded.
  #ownMatches = new Map<Schema, true>();

  #closestViews = new Map<Schema, BasicSubscribable<Scope | null>>();
  #findAllViews = new Map<Schema, BasicSubscribable<readonly Scope[]>>();

  constructor() {
    this.#engine = { schemas: new Set(), scopes: new Set() };
    this.#engine.scopes.add(this);
  }

  get children(): readonly Scope[] {
    return this.#children;
  }

  get handle(): Handle | null {
    return this.#handle;
  }

  /**
   * Attaching a handle: subscribe to its change stream so future
   * `change(next)` calls flow back into our own-match recompute. The
   * `Handle.subscribe` contract requires firing once synchronously with
   * the current value, so the initial schema parse happens here without
   * a separate code path.
   *
   * Detaching (set to null): unsubscribe and re-run the recompute,
   * which now sees `this.#handle === null` and clears every match.
   */
  set handle(next: Handle | null) {
    if (next === this.#handle) return;
    this.#unsubHandle?.();
    this.#unsubHandle = null;
    this.#handle = next;
    if (next) {
      this.#unsubHandle = next.subscribe(() => this.#onHandleValueChange());
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
  create(handle?: Handle): Scope {
    const child = new Scope();
    // Discard child's throwaway engine and reattach to ours.
    child.#engine.scopes.delete(child);
    child.#engine = this.#engine;
    child.#engine.scopes.add(child);
    child.parent = this;
    this.#children.push(child);

    if (handle) child.handle = handle;

    // Structural invalidation. Redundant with the handle-attach
    // invalidation when `handle` was passed (`Object.is` / shallow-array
    // dedup absorbs the duplicate fire), but covers the no-handle case
    // where findAll at ancestors still needs to settle.
    for (const s of this.#engine.schemas) {
      Scope.#invalidateClosestSubtree(child, s);
      Scope.#invalidateUpward(this, s);
    }
    return child;
  }

  /**
   * Reparent this scope under `newParent`. Cycles and cross-tree moves
   * throw — both are programmer errors with no sensible recovery. The
   * verb-on-the-child phrasing reads naturally for reparenting; the
   * DOM equivalent is `newParent.appendChild(this)` (or `append`),
   * which we don't expose because `create` already covers the
   * "create + insert" case.
   */
  moveTo(newParent: Scope): void {
    if (newParent.#engine !== this.#engine) {
      throw new Error("scope: cannot move scope across trees");
    }
    if (newParent === this || Scope.#isAncestorOf(this, newParent)) {
      throw new Error("scope: cannot move into itself or a descendant");
    }
    this.remove();
    this.parent = newParent;
    newParent.#children.push(this);
    for (const s of this.#engine.schemas) {
      Scope.#invalidateClosestSubtree(this, s);
      Scope.#invalidateUpward(newParent, s);
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
      Scope.#invalidateUpward(oldParent, s);
    }
  }

  closest<T>(schema: Schema<T>): Subscribable<Scope | null> {
    this.#registerSchema(schema);
    let view = this.#closestViews.get(schema);
    if (view) return view;
    view = new BasicSubscribable<Scope | null>(
      Scope.#computeClosest(this, schema),
    );
    this.#closestViews.set(schema, view);
    return view;
  }

  findAll<T>(schema: Schema<T>): Subscribable<readonly Scope[]> {
    this.#registerSchema(schema);
    let view = this.#findAllViews.get(schema);
    if (view) return view;
    view = new BasicSubscribable<readonly Scope[]>(
      Scope.#computeFindAll(this, schema),
      shallowArrayEquals,
    );
    this.#findAllViews.set(schema, view);
    return view;
  }

  /**
   * Run by the handle's `subscribe` callback (and by the setter when
   * `handle` is cleared to null). Re-parses every registered schema
   * against the current value and fan-out any flips.
   */
  #onHandleValueChange(): void {
    for (const schema of this.#engine.schemas) {
      if (!this.#recomputeOwnMatch(schema)) continue;
      Scope.#invalidateClosestSubtree(this, schema);
      Scope.#invalidateUpward(this.parent, schema);
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
   * Walk from `start` (inclusive) up to the root, recomputing every
   * materialised `findAll` view for `schema`. Used after any change
   * that adds or removes a match somewhere in the affected subtree.
   */
  static #invalidateUpward(start: Scope | null, schema: Schema): void {
    let cur = start;
    while (cur) {
      const fa = cur.#findAllViews.get(schema);
      if (fa) fa.change(Scope.#computeFindAll(cur, schema));
      cur = cur.parent;
    }
  }

  static #computeClosest(scope: Scope, schema: Schema): Scope | null {
    let cur: Scope | null = scope;
    while (cur) {
      if (cur.#ownMatches.has(schema)) return cur;
      cur = cur.parent;
    }
    return null;
  }

  /**
   * Full-subtree walk in pre-order: every matching descendant of
   * `scope`, regardless of whether a closer match shadows it. The "all
   * data in scope" view — at the root, this is a live, schema-keyed
   * index of every typed scope in the whole tree.
   */
  static #computeFindAll(scope: Scope, schema: Schema): Scope[] {
    const out: Scope[] = [];
    function visit(s: Scope): void {
      if (s.#ownMatches.has(schema)) out.push(s);
      for (const c of s.#children) visit(c);
    }
    for (const c of scope.#children) visit(c);
    return out;
  }
}
