# Internals

Implementation details of the view registry, the plugin registry, and
the per-element lifecycle. Read this before changing
[`src/view-registry.ts`](../src/view-registry.ts),
[`src/plugin-registry.ts`](../src/plugin-registry.ts), or
[`src/view.ts`](../src/view.ts).

## Why `<patchwork-view>` and `<automerge-repo>` are custom elements

Two registrations live in their own files —
[`src/patchwork-view-element.ts`](../src/patchwork-view-element.ts) and
[`src/automerge-repo-element.ts`](../src/automerge-repo-element.ts) —
and run as side-effect `customElements.define` calls on module load:

```ts
class PatchworkView extends HTMLElement {
  get src(): string { return this.getAttribute("src") ?? ""; }
  set src(v: string | null | undefined) { reflectAttribute(this, "src", v); }
  get doc(): string { return this.getAttribute("doc") ?? ""; }
  set doc(v: string | null | undefined) { reflectAttribute(this, "doc", v); }
  connectedMoveCallback(): void {}
}
class AutomergeRepoElement extends HTMLElement {
  repo: BranchableRepo | null = null;
  connectedMoveCallback(): void {}
}
```

Frameworks that template-render hyphenated tags tend to write attribute
slots as JS *properties* (Solid does, Lit does). On a plain
`HTMLElement` that's a JS expando — never reflects to the attribute,
so the registry's `getAttribute(...)` read sees nothing. Reflecting
`src` and `doc` accessors back through `setAttribute` keeps the
MutationObserver-based bootstrap working.

`reflectAttribute` short-circuits redundant writes: it skips when the
attribute already matches the new value, and `removeAttribute`s
(rather than writing `""`) when the value is null/undefined/empty.
That keeps reactive frameworks that re-call setters every render from
flooding the registry's MutationObserver with attribute records.

`PatchworkView`'s constructor also runs the standard "lazy property
upgrade" dance for `src` and `doc`: when an element is cloned out of
a `<template>` (Solid does this), dynamic attribute writes happen
*before* the prototype has been swapped to `PatchworkView`, so they
land as own data properties. Reading + deleting + re-assigning forces
the value back through the setter so the attribute shows up.

The empty `connectedMoveCallback() {}` on both classes opts the
elements into the `Element.moveBefore()` lifecycle: when the platform
moves a node via `moveBefore`, it fires `connectedMoveCallback`
*instead of* `disconnectedCallback` + `connectedCallback`. Solid's
`<For>` reorders use `moveBefore` on browsers that support it; the
no-op declaration is what tells the platform "this element survives
moves intact."

`AutomergeRepoElement` doesn't reflect anything — `repo` is a typed
*property* slot for the registry to write into and for views to read
out of. Putting it on a registered class instead of a plain expando
just means TypeScript / DevTools recognize it. The class also exposes
`checkout` / `fork` / `reset` mutators and a `_rebuildDescendants`
internal hook the registry installs on first sight; the mutators call
through to the hook to rebuild every view descendant whose nearest
`<automerge-repo>` ancestor is this element.

These are the *only* two places in the system that use
`customElements`. User views stay plain `document.createElement(name)`
elements and are never registered globally — `customElements.define`
is a one-shot ratchet that would block HMR. View identity is the
element itself, with mount state tracked in `view.ts`'s `cleanups`
map (see below).

## Registry data structures

The registry doesn't track `View` instances — there *are* no `View`
instances. The element is the identity carrier for a mounted view;
per-element state lives in `view.ts`'s module-private `cleanups` map.
The registry's own state is just:

- **`#viewsByTag`** — `Map<string, MountFn>` for tag-name to mount-fn.
  Throws on collision both on initial load and on HMR rename.
- **`#onPluginUpdate`** — listener arrow function bound to the single
  `pluginRegistry.on("updated", ...)` subscription installed in the
  constructor. Detached via `pluginRegistry.off(...)` in `destroy()`.
  The HMR rebuild fans out *one* event source to every plugin URL
  the view registry cares about, so a per-URL listener map isn't
  needed.
- **`#claimedViews`** — `WeakSet<Element>` tracking which
  `<patchwork-view>` elements have already been claimed, so a remove
  + re-add cycle on the same node doesn't kick off a duplicate load.
- **`#pendingRebuilds`** — `Set<HTMLElement>` of elements whose `doc=`
  flipped this tick. Drained on a microtask so coalesced writes
  produce a single rebuild. Stale entries (an element that was already
  rebuilt and is no longer claimed) are filtered out at flush via
  `isView`.

## Plugin registry

The plugin URL → `LoadedPlugin` cache and the folder subscription
that drives HMR live in `PluginRegistry`
([`src/plugin-registry.ts`](../src/plugin-registry.ts)), not in
`ViewRegistry`. The plugin registry knows nothing about the DOM or
about view-specific shape — every plugin kind layers its own
validation on top of the generic `LoadedPlugin` shape.

`PluginRegistry` extends `EventEmitter` from `eventemitter3` and uses
the standard `on(event, fn)` / `off(event, fn)` pair (matching
`automerge-repo`'s `Repo` and `DocHandle`). Required `LoadedPlugin`
fields are minimal:

```ts
type LoadedPlugin = {
  name: string;       // tag name (view plugins; opaque to others)
  importUrl: string;  // resolved absolute automerge: URL
  module: unknown;    // raw imported JS module
  [key: string]: unknown;  // arbitrary manifest fields preserved
};

type PluginRegistryOptions = {
  repo: BranchableRepo;
  import: (url: string) => Promise<unknown>;
};
```

The manifest JSON only has to declare `name` and `importUrl`; any
other fields are passed through opaquely so plugin kinds can add
their own required fields (`type`, `icon`, etc.) without touching
the registry. `importUrl` on the manifest is a `./`-relative
sibling reference; the registry resolves it to an absolute URL
when fetching, so the `importUrl` on the emitted `LoadedPlugin` is
always absolute (and not heads-pinned — pinning is a load-time
detail).

A "plugin URL" is an `automerge:<docId>/<path/to/manifest.json>`
pair: the root document URL of a folder doc plus a path to the
manifest file inside it. The registry uses the full string as the
cache key.

The public surface:

- **`load(url)`** — `Promise<LoadedPlugin>`. Idempotent; concurrent
  calls share the in-flight promise; subsequent calls hit the cache.
  The manifest's parent folder subscription is set up on first
  load. Fires `loaded` (and `changed`) on first successful
  resolution; cache hits do not re-fire.
- **`remove(url)`** — drops the cached entry and its folder
  subscription. Fires `removed` and `changed`. Returns `true` if the
  URL was cached.
- **`destroy()`** — drops every folder subscription, clears the
  cache, and removes all listeners. After destroy, `load` rejects.

Events:

| event     | args                                               | when |
| --------- | -------------------------------------------------- | ---- |
| `loaded`  | `(pluginUrl, plugin)`                              | first successful load |
| `updated` | `(pluginUrl, previous, next)`                      | HMR re-fetch produced a new manifest or module |
| `removed` | `(pluginUrl)`                                      | `remove(pluginUrl)` evicted a cached entry |
| `changed` | `()`                                               | fires alongside every other event |

Patchwork-next has a `registered` event for description-only state.
We don't have an analog because `load(url)` is the entry point;
there's no two-step register-then-load lifecycle.

The plugin registry has no opinion on what counts as an observable
change: it always fires `updated` after a successful re-fetch and
lets the consumer dedupe. The view registry's `#onPluginUpdate`
short-circuits when both `name` and the `module` reference are
unchanged — that's a defensive check against spurious folder
events, not the main optimization path.

Per-element state — the cleanups map keyed by element — sits in
[`view.ts`](../src/view.ts) as `WeakMap<Element, cleanup | null>`.
`WeakMap` so the map never keeps DOM nodes alive on its own.
`mountView` claims an entry synchronously; `unmountView` drains it;
`isView(el)` answers "is this element currently a view?" for the
registry's own dedup.

The cleanups map is process-wide on purpose: two `ViewRegistry`
instances over disjoint subtrees never see each other's elements. On
overlapping subtrees they would conflict — which is the same answer
either way.

## Scope tree

Alongside `cleanups`, [`view.ts`](../src/view.ts) maintains a second
`WeakMap<Element, ViewScope>` (`scopes`) and a reverse
`WeakMap<Scope, HTMLElement>` (`scopeToElement`). Together they back
the `closestView` / `ancestorView` / `childViews` lookups exposed on
every `ViewElement`.

Lifecycle:

- **Stamp.** `mountView` calls `stampScope(el)` *synchronously*, before
  any `await`. It walks `el.parentElement` looking for an ancestor
  view's scope; with one, calls `parentScope.create()` to allocate a
  child of the same engine; without one (the topmost view in this
  tree), `new Scope()` becomes its own engine root. The `scopes`
  WeakMap and the reverse `scopeToElement` are populated together.
- **Attach handle.** Once `resolveContext` resolves a `DocHandle`,
  `attachHandleToScope` wraps it in a `Handle<unknown>` adapter
  (forwarding `change` events) and assigns it to `scope.handle`. The
  setter fires the initial schema parse manually since `Handle.on`
  doesn't auto-fire (mirroring `DocHandle`). Doc-less views skip this
  step and keep `scope.handle = null` — they exist as transparent
  pass-throughs but never match any schema.
- **Install lookups.** `stampLookups(el)` writes `closestView` /
  `ancestorView` / `childViews` onto the element. Each method bottoms
  out in the scope's `closest` / `findChildren` view (a `Handle`) and
  maps the scope-typed result back to a view element via
  `scopeToElement` so consumers see element-shaped results.
- **Tear down.** `unmountView` calls `releaseScope(el)`, which removes
  the doc-handle adapter listener (`disposeHandle`), clears the scope's
  handle, and detaches the scope from its parent (`scope.remove()`).
  Detachment fans out structural invalidations to surviving ancestors'
  `findChildren` views and to descendants' `closest` views.

Two top-level views with no shared ancestor view become separate
trees with separate engines — so schema registration and `findChildren`
visibility are scoped to whichever subtree the topmost view roots. In
practice every page roots at one top-level component, so this is a
non-issue.

Move semantics today: a DOM move that the registry observes as
`removedNodes` + `addedNodes` runs `unmountView` then `mountView`,
which destroys and recreates the scope. That's "destroy + insert"
semantics — fine for now, and consistent with the `_rebuildDescendants`
path on `<automerge-repo>` swaps. The structural information is
preserved because the new mount finds the right parent scope through
its `parentElement` walk.

## Module layout

```
src/loader.ts             importFromAutomerge entry point, URL helpers
                          (parseAutomergeUrlWithPath, pinUrl, splitPath),
                          page-global blob cache. No DOM dependency.
src/handle.ts             Handle<T>: framework reactive primitive —
                          extends EventEmitter, value()/change(next),
                          fires "change". Plus shallowArrayEquals.
src/scope.ts              Scope: per-view node in the schema-indexed
                          lookup tree. Owns engine state, registered
                          schemas, per-scope closest/findChildren
                          Handles. No DOM dependency.
src/plugin-registry.ts    PluginRegistry: pluginUrl -> LoadedPlugin
                          load cache, per-URL folder subscription,
                          eventemitter3 events (loaded/updated/
                          removed/changed). No DOM dependency.
src/view-registry.ts      ViewRegistry: DOM observer, tag-name
                          table, <patchwork-view> bootstrap, swapTag,
                          microtask-batched doc= rebuild, HMR rebuild
                          via pluginRegistry.on("updated", ...)
src/patchwork-view-element.ts
                          PatchworkView class +
                          customElements.define; src/doc reflection,
                          lazy property upgrade, connectedMoveCallback
src/automerge-repo-element.ts
                          AutomergeRepoElement class +
                          customElements.define; .repo property,
                          checkout/fork/reset mutators
src/view.ts               mountView / unmountView / isView:
                          per-element lifecycle, doc-context
                          resolution, el.repo + scope stamping,
                          closestView/ancestorView/childViews install,
                          in-flight race guard via el.isConnected.
                          Owns the WeakMap<Element, cleanup | null>
                          and the WeakMap<Element, ViewScope>. Exports
                          ViewElement, SchemaViewElement, MountFn.
```

`PluginRegistry` depends on the loader half of overlock for two things:

- `repo: BranchableRepo` — used to resolve folders and manifests.
  Operations that must never be branched (e.g. `findHandleInFolderHandle`
  from `@inkandswitch/patchwork-filesystem`, and `pinUrl` for module
  resolution) call into `repo.repo` directly.
- `import: (url) => Promise<unknown>` — used to fetch and evaluate
  `component.js` as an ES module. Wired in `src/main.ts` to
  `importFromAutomerge(repo, url)` against the raw `Repo` so module
  resolution is never affected by branches.

`ViewRegistry` depends on `PluginRegistry` (for plugin loading + HMR)
and `BranchableRepo` (for the `<automerge-repo>` marker fallback). It
does *not* see the loader directly.

Both registries are wired up in [`src/main.ts`](../src/main.ts).

## Constraints and limits

- **Tag names need a hyphen.** Enforced when reading the manifest.
  Matches the HTML custom-element naming rule and avoids accidental
  collisions with built-ins.
- **Manifest `url` must start with `./`.** Cross-package and bare
  specifiers in the manifest are rejected so HMR's pinning semantics
  stay obvious — the JS module always lives in the same folder doc
  as its manifest.
- **No namespaces yet.** View name collisions throw immediately,
  both on initial load and on HMR rename.
- **`doc=` requires `<automerge-repo>`.** Setting `doc=` on a
  `<patchwork-view>` outside any `<automerge-repo>` ancestor is an
  error; the mount is aborted with a logged exception. Views that
  don't need a doc (e.g. `clock`) work fine with no scope.
- **`el.repo` stamping.** Every view element has `el.repo` set
  synchronously inside `mountView` from
  `el.closest("automerge-repo")`. Outside any `<automerge-repo>`
  ancestor, `el.repo` is `undefined` and the view is responsible for
  handling that gracefully. The `<automerge-repo>` marker's `repo`
  property is stamped by the registry's tree-order initial walk
  before any descendant `<patchwork-view>` bootstraps, so the lookup
  is always populated by the time a view reads `el.repo`.
