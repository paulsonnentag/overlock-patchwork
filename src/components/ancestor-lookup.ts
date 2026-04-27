import type { BranchableRepo } from "../branchable-repo.js";
import * as componentStore from "./component-store.js";
import type {
  ComponentRoot,
  Schema,
  SchemaComponentRoot,
} from "./types.js";

// Source of truth for these tag names is `component-registry.ts`. Duplicated
// here as string literals to avoid a registry → component → ancestor-lookup
// → registry import cycle.
const BOOTSTRAP_TAG = "patchwork-view";
const REPO_TAG = "automerge-repo";

/**
 * Walk up the DOM from `start` (inclusive) returning the first element
 * that is a registered component and — if a schema is provided — whose
 * `handle.doc()` parses under the schema. Elements without a `handle` are
 * skipped under schema filtering and returned under no-schema lookups.
 *
 * Pure DOM walk + `componentStore` reads. No registry state required, so
 * the walker is safe to expose as an element method without coupling
 * elements back to a `ComponentRegistry` instance.
 */
function findComponent<T>(
  start: Element | null,
  schema: Schema<T>,
): SchemaComponentRoot<T> | null;
function findComponent(start: Element | null): ComponentRoot | null;
function findComponent<T>(
  start: Element | null,
  schema?: Schema<T>,
): ComponentRoot | SchemaComponentRoot<T> | null {
  let cur: Element | null = start;
  while (cur) {
    if (cur instanceof HTMLElement && componentStore.lookup(cur)) {
      const el = cur as ComponentRoot;
      if (!schema) return el;
      const handle = el.handle;
      if (handle) {
        try {
          schema.parse(handle.doc());
          return el as SchemaComponentRoot<T>;
        } catch {
          // not a match, keep walking
        }
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Walk descendants of `root`, stopping at component boundaries, and
 * return the nearest-component descendants. A child counts as a
 * "component boundary" if either:
 *
 * - it has a registered `Component` in `componentStore` (already
 *   bootstrapped + swapped), or
 * - its tag is `<patchwork-view>` (still in flight; the registry hasn't
 *   yet swapped its tag and stamped its `Component`).
 *
 * Both shapes are reported. Including pre-swap `<patchwork-view>`s in the
 * result is important because consumers typically want to set `doc=` on
 * each before — or as — bootstrap completes; the registry then picks the
 * attribute up either via its in-flight resolve (pre-swap) or via the
 * `doc=` MutationObserver rebuild (post-swap).
 *
 * Recursion stops at every component boundary, so wrapping non-component
 * elements (e.g. a `<div>`) are descended into transparently and only the
 * outermost component descendants are returned.
 *
 * Under schema filtering, candidates without a `handle` (pre-swap, or
 * post-swap with no `doc=`) are skipped, matching the ancestor walker's
 * semantics.
 */
function findChildComponents<T>(
  root: Element,
  schema: Schema<T>,
): SchemaComponentRoot<T>[];
function findChildComponents(root: Element): ComponentRoot[];
function findChildComponents<T>(
  root: Element,
  schema?: Schema<T>,
): ComponentRoot[] | SchemaComponentRoot<T>[] {
  const out: ComponentRoot[] = [];
  function isBoundary(child: Element): boolean {
    if (child.localName === BOOTSTRAP_TAG) return true;
    return componentStore.lookup(child) != null;
  }
  function visit(parent: Element): void {
    for (const child of Array.from(parent.children)) {
      if (isBoundary(child)) {
        const candidate = child as ComponentRoot;
        if (schema) {
          const handle = candidate.handle;
          if (!handle) continue;
          try {
            schema.parse(handle.doc());
            out.push(candidate);
          } catch {
            // not a match — and we still don't descend, because this
            // element is a component boundary regardless of whether its
            // doc parses.
          }
        } else {
          out.push(candidate);
        }
      } else {
        visit(child);
      }
    }
  }
  visit(root);
  return out;
}

/**
 * Stamp ancestor / descendant lookup methods plus `el.repo` onto a
 * freshly mounted component element. Call once per Component,
 * synchronously, before any `await` in the registry's mount path so a
 * child mount fn can rely on the methods being present.
 *
 * Methods close over `el` so detached calls
 * (`const f = el.closestComponent`) still resolve against the right
 * element. `el.repo` is read from the closest `<automerge-repo>` ancestor;
 * tree-order construction guarantees the marker has been visited and
 * stamped by the registry before any descendant component reaches this
 * function. Outside any `<automerge-repo>` ancestor, `el.repo` stays
 * `undefined`.
 */
export function stampLookups(el: HTMLElement): void {
  const root = el as ComponentRoot;
  function closestComponent<T>(
    schema: Schema<T>,
  ): SchemaComponentRoot<T> | null {
    return findComponent(el, schema);
  }
  function ancestorComponent(): ComponentRoot | null;
  function ancestorComponent<T>(
    schema: Schema<T>,
  ): SchemaComponentRoot<T> | null;
  function ancestorComponent<T>(
    schema?: Schema<T>,
  ): ComponentRoot | SchemaComponentRoot<T> | null {
    return schema
      ? findComponent(el.parentElement, schema)
      : findComponent(el.parentElement);
  }
  function componentChildren(): ComponentRoot[];
  function componentChildren<T>(schema: Schema<T>): SchemaComponentRoot<T>[];
  function componentChildren<T>(
    schema?: Schema<T>,
  ): ComponentRoot[] | SchemaComponentRoot<T>[] {
    return schema ? findChildComponents(el, schema) : findChildComponents(el);
  }
  root.closestComponent = closestComponent;
  root.ancestorComponent = ancestorComponent;
  root.componentChildren = componentChildren;

  const repoEl = el.closest(REPO_TAG) as
    | (HTMLElement & { repo?: BranchableRepo | null })
    | null;
  root.repo = repoEl?.repo ?? undefined;
}
