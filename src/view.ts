import {
  isValidAutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";

import {
  AUTOMERGE_REPO_TAG,
  type AutomergeRepoElement,
} from "./automerge-repo-element";
import type { BranchableRepo } from "./branchable-repo";
import { Handle } from "./handle";
import { Scope, type Schema } from "./scope";

/**
 * The element a mount fn receives. A plain `HTMLElement` plus:
 *
 * - `handle?` — the `DocHandle` resolved from the `doc=` attribute
 *   (absent when the host element had no `doc=`). The handle has stable
 *   identity across branch operations; switching branches swaps the
 *   handle's inner ref under the hood and surfaces as a `change` event,
 *   so consumers can listen with the standard `handle.on("change", …)`
 *   and don't need to re-acquire the reference.
 * - `repo?` — the `BranchableRepo` from the closest `<automerge-repo>`
 *   ancestor, stamped at construction time. Absent when the element is
 *   mounted outside any `<automerge-repo>` scope. The repo is stateful:
 *   `element.repo.checkout(...)` / `element.repo.fork(...)` /
 *   `element.repo.reset()` mutate the same instance in place. Call
 *   `element.repo.copy()` to obtain a fresh instance.
 * - `closestView(schema)` — walk self → ancestors; the first view
 *   element whose `handle.doc()` parses under `schema`. Returns a
 *   `Handle` whose `value()` is the match (or `null`).
 * - `ancestorView()` / `ancestorView(schema)` — same as `closestView`
 *   but starts at the parent. Without a schema returns the nearest
 *   ancestor view regardless of doc.
 * - `childViews()` / `childViews(schema)` — direct view-children
 *   (transparent through plain DOM). With a schema, only those whose
 *   doc parses; without, every direct child view.
 *
 * The lookup methods are scope-tree-backed (`src/scope.ts`); they fire
 * when structural or content changes flip the answer. There is no DOM
 * walking on the read path.
 */
export type ViewElement<V = unknown> = HTMLElement & {
  handle?: DocHandle<V>;
  repo?: BranchableRepo;
  closestView<T>(schema: Schema<T>): Handle<SchemaViewElement<T> | null>;
  ancestorView(): Handle<ViewElement | null>;
  ancestorView<T>(schema: Schema<T>): Handle<SchemaViewElement<T> | null>;
  childViews(): Handle<ViewElement[]>;
  childViews<T>(schema: Schema<T>): Handle<SchemaViewElement<T>[]>;
};

/**
 * Result of a schema-filtered lookup. `handle` is non-optional because
 * the walker only returns elements whose handle's doc parsed under the
 * schema, so consumers can use the result both as an element reference
 * (e.g. to forward `doc=`) and as a typed `DocHandle` source.
 */
export type SchemaViewElement<T> = ViewElement<T> & { handle: DocHandle<T> };

/**
 * A view's default export. Returns either nothing or a cleanup fn.
 *
 * The mount fn is `async` so authors can `await repo.find(...)`, dynamic
 * imports, etc. before they touch the element. Races (element removed
 * mid-mount, source hot-reloaded mid-mount, `doc=` flipped mid-mount)
 * are observed by `mountView` via `el.isConnected` after each await:
 * if the element disconnected while the mount fn was in flight, the
 * returned cleanup runs immediately and is discarded rather than
 * installed.
 */
export type MountFn = (
  element: ViewElement,
) => Promise<(() => void) | void> | ((() => void) | void);

/**
 * `WeakMap<Element, cleanup | null>` keyed by every element that has
 * been claimed by `mountView` and not yet unmounted. Three states:
 *
 * - not in the map: `el` is not a mounted view.
 * - value `null`: `el` is in flight (resolving doc context or running
 *   the user's mount fn), or has finished mounting with no user
 *   cleanup to install.
 * - value `() => void`: mounted with a user cleanup ready to run.
 *
 * The element is the identity carrier for a mounted view; there is no
 * View instance. The map is the only persistent per-view state in the
 * system.
 *
 * Entries are claimed *synchronously* at the top of `mountView`. That
 * matters because the registry's `MutationObserver` may fire on the
 * same microtask for a freshly inserted element; without the
 * synchronous claim, the registry's `mountIfRegistered` would see the
 * element as un-claimed and start a duplicate mount.
 */
const cleanups = new WeakMap<Element, (() => void) | null>();

/**
 * Per-element scope bookkeeping. Stamped synchronously alongside the
 * cleanup claim so descendant mounts on the next microtask can already
 * resolve the parent scope through a `parentElement` walk. Every entry
 * has a matching `scopeToElement` reverse mapping so scope-keyed
 * lookups can return element references back to consumers.
 *
 * The `disposeHandle` callback unsubscribes the doc-handle adapter
 * from `DocHandle.on("change", ...)` when the view tears down — without
 * it, the adapter would keep the listener attached for the lifetime of
 * the underlying repo.
 */
type ViewScope = {
  scope: Scope;
  disposeHandle?: () => void;
};

const scopes = new WeakMap<Element, ViewScope>();
const scopeToElement = new WeakMap<Scope, HTMLElement>();

/**
 * Mount a view on `el` against `mountFn`. Synchronously claims the
 * element (so the registry sees it as already-mounted on the next
 * MutationObserver microtask), stamps `el.repo` from the closest
 * `<automerge-repo>` ancestor, creates a fresh `Scope` as a child of
 * the nearest ancestor view's scope, and installs the contextual
 * `closestView` / `ancestorView` / `childViews` lookups. Then runs the
 * async lifecycle:
 *
 * 1. Resolve doc context — read `doc=`, find the closest
 *    `<automerge-repo>` ancestor, await `repo.find(url)`, stamp the
 *    resulting handle as `el.handle` and attach it to the scope. No
 *    `doc=` is fine and leaves both untouched (the scope still exists,
 *    just without a handle, so descendants traverse through it).
 * 2. If the element was disconnected during step 1, drop the claim and
 *    exit. The user's mount fn never runs.
 * 3. Run the user's `mountFn(el)`. If it throws, log and exit; the
 *    element stays claimed with no cleanup so a later removal is a
 *    safe no-op.
 * 4. If the element was disconnected while `mountFn` was awaiting,
 *    run the returned cleanup immediately and discard it instead of
 *    installing it. That's the race guarantee for in-flight mounts.
 * 5. Otherwise install the cleanup so a later `unmountView(el)`
 *    (or rebuild) runs it.
 */
export function mountView(el: HTMLElement, mountFn: MountFn): void {
  cleanups.set(el, null);
  stampRepo(el);
  stampScope(el);
  stampLookups(el);
  void runLifecycle(el, mountFn);
}

/**
 * Run the cleanup (if any) associated with `el` and forget the
 * element. Idempotent. Safe on elements that were never mounted (no-op),
 * on in-flight mounts (drops the claim so the in-flight closure's
 * `isConnected` check short-circuits the install path), and on
 * already-unmounted elements.
 *
 * Tears down the scope alongside the cleanup so structural lookups on
 * surviving ancestors (e.g. a parent's `childViews`) re-fire with the
 * removed entry dropped.
 */
export function unmountView(el: Element): void {
  const cleanup = cleanups.get(el);
  if (cleanup === undefined) return;
  cleanups.delete(el);
  releaseScope(el);
  if (cleanup) runCleanup(cleanup);
}

/**
 * Whether `el` is currently claimed by `mountView` (in flight or
 * fully mounted). Used by the registry's `mountIfRegistered` to dedup.
 */
export function isView(el: Element): boolean {
  return cleanups.has(el);
}

async function runLifecycle(
  el: HTMLElement,
  mountFn: MountFn,
): Promise<void> {
  try {
    await resolveContext(el);
  } catch (err) {
    console.error("[overlock-patchwork] doc context resolution failed:", err);
    cleanups.delete(el);
    releaseScope(el);
    return;
  }
  if (!el.isConnected) {
    cleanups.delete(el);
    releaseScope(el);
    return;
  }

  let result: (() => void) | void;
  try {
    result = await mountFn(el as ViewElement);
  } catch (err) {
    console.error(
      `[overlock-patchwork] mount threw on <${el.localName}>:`,
      err,
    );
    return;
  }

  const cleanup = typeof result === "function" ? result : null;
  if (!el.isConnected) {
    if (cleanup) runCleanup(cleanup);
    cleanups.delete(el);
    releaseScope(el);
    return;
  }
  cleanups.set(el, cleanup);
}

/**
 * Read `doc=` off `el`, find the closest `<automerge-repo>` ancestor,
 * await `repo.find(url)`, and stamp the resulting handle onto the
 * element as `el.handle`. Strict: a `doc=` attribute without an
 * `<automerge-repo>` ancestor is an error. No `doc=` is fine and
 * leaves `el.handle` untouched.
 */
async function resolveContext(el: HTMLElement): Promise<void> {
  const docUrl = el.getAttribute("doc");
  if (!docUrl) return;

  const repoEl = el.closest(AUTOMERGE_REPO_TAG) as AutomergeRepoElement | null;
  if (!repoEl?.repo) {
    throw new Error(
      `[overlock-patchwork] <${el.localName} doc="${docUrl}"> requires an <${AUTOMERGE_REPO_TAG}> ancestor`,
    );
  }
  if (!isValidAutomergeUrl(docUrl)) {
    throw new Error(
      `[overlock-patchwork] doc attribute is not a valid automerge URL: "${docUrl}"`,
    );
  }

  const handle = await repoEl.repo.find(docUrl);
  (el as ViewElement).handle = handle as DocHandle<unknown>;
  attachHandleToScope(el, handle as DocHandle<unknown>);
}

function stampRepo(el: HTMLElement): void {
  const repoEl = el.closest(AUTOMERGE_REPO_TAG) as AutomergeRepoElement | null;
  (el as ViewElement).repo = repoEl?.repo ?? undefined;
}

/**
 * Walk `el.parentElement` looking for an ancestor view's scope. With
 * no ancestor scope (the topmost view in this tree), `new Scope()` is
 * its own engine root — there's no global root scope owned by the
 * registry. Two top-level views with no shared ancestor view become
 * separate trees with separate schema registrations.
 */
function stampScope(el: HTMLElement): void {
  const parentScope = findAncestorScope(el);
  const scope = parentScope ? parentScope.create() : new Scope();
  scopes.set(el, { scope });
  scopeToElement.set(scope, el);
}

function findAncestorScope(el: HTMLElement): Scope | null {
  let cur = el.parentElement;
  while (cur) {
    const entry = scopes.get(cur);
    if (entry) return entry.scope;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Adapt a `DocHandle` into the framework's `Handle` shape and attach
 * it as the scope's `handle` source. Forwards `change` events so
 * schema parses re-run on every doc edit. The teardown function is
 * stored alongside the scope so `unmountView` can detach the listener.
 */
function attachHandleToScope(
  el: HTMLElement,
  docHandle: DocHandle<unknown>,
): void {
  const entry = scopes.get(el);
  if (!entry) return;
  const adapter = new Handle<unknown>(docHandle.doc());
  const onChange = () => adapter.change(docHandle.doc());
  docHandle.on("change", onChange);
  entry.disposeHandle = () => docHandle.off("change", onChange);
  entry.scope.handle = adapter;
}

function releaseScope(el: Element): void {
  const entry = scopes.get(el);
  if (!entry) return;
  scopes.delete(el);
  scopeToElement.delete(entry.scope);
  entry.disposeHandle?.();
  entry.scope.handle = null;
  entry.scope.remove();
}

/**
 * Install `closestView` / `ancestorView` / `childViews` on the view
 * element. Each method bottoms out in the scope's `closest` /
 * `findChildren` view (a `Handle`) and maps the scope-typed value
 * back to a view element via `scopeToElement` so consumers see the
 * familiar element-shaped result and can read `el.handle`.
 *
 * The mapped `Handle`s are created once per call. Underlying scope
 * views are cached on the scope itself, so repeat calls with the same
 * schema reuse the same upstream `Handle` even though they hand back a
 * fresh mapped wrapper. That's fine — the wrapper's only state is its
 * subscription to the upstream, which stops firing when the scope
 * tears down on `unmountView`.
 */
function stampLookups(el: HTMLElement): void {
  const ve = el as ViewElement;
  ve.closestView = <T>(schema: Schema<T>) =>
    mapHandle(getScope(el).closest(schema), (s) =>
      s ? (scopeToElement.get(s) as SchemaViewElement<T>) ?? null : null,
    );
  ve.ancestorView = (<T>(schema?: Schema<T>) => {
    const parent = getScope(el).parent;
    if (!parent) {
      return new Handle<ViewElement | SchemaViewElement<T> | null>(null);
    }
    if (schema) {
      return mapHandle(parent.closest(schema), (s) =>
        s ? (scopeToElement.get(s) as SchemaViewElement<T>) ?? null : null,
      );
    }
    // No schema: the immediate parent scope is, by construction, a
    // mounted view. Hand it back directly without filtering through
    // the schema-keyed lookup (which would skip handle-less ancestors).
    return new Handle<ViewElement | null>(
      (scopeToElement.get(parent) as ViewElement) ?? null,
    );
  }) as ViewElement["ancestorView"];
  ve.childViews = (<T>(schema?: Schema<T>) => {
    if (schema) {
      return mapHandle(
        getScope(el).findChildren(schema),
        (list) =>
          list
            .map((s) => scopeToElement.get(s))
            .filter((e): e is HTMLElement => e !== undefined) as
            SchemaViewElement<T>[],
        shallowArrayEqualsAny,
      );
    }
    // No schema: every direct child view, including handle-less ones.
    // Context-providers set `doc=` on their children *before* the
    // handles attach, so filtering by `#ownMatches` would be a deadlock.
    return mapHandle(
      getScope(el).findAllChildren(),
      (list) =>
        list
          .map((s) => scopeToElement.get(s))
          .filter((e): e is HTMLElement => e !== undefined) as ViewElement[],
      shallowArrayEqualsAny,
    );
  }) as ViewElement["childViews"];
}

function getScope(el: Element): Scope {
  const entry = scopes.get(el);
  if (!entry) {
    throw new Error(
      "[overlock-patchwork] view lookup called on an unclaimed element",
    );
  }
  return entry.scope;
}

/**
 * Local helper instead of importing `shallowArrayEquals` for `unknown[]`
 * vs `T[]` typing — saves a cast at every callsite.
 */
function shallowArrayEqualsAny(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

function mapHandle<T, U>(
  src: Handle<T>,
  map: (value: T) => U,
  equals?: (a: U, b: U) => boolean,
): Handle<U> {
  const out = new Handle<U>(map(src.value()), equals);
  src.on("change", (v) => out.change(map(v)));
  return out;
}

function runCleanup(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error("[overlock-patchwork] cleanup threw", err);
  }
}
