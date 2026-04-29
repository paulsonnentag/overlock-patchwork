# Internals

Implementation details of the view registry, the plugin registry, and
the per-element lifecycle. Read this before changing
[`src/view-registry.ts`](../src/view-registry.ts),
[`src/plugin-registry.ts`](../src/plugin-registry.ts), or
[`src/view.ts`](../src/view.ts).

## Why `<patchwork-view>` is a custom element

One registration lives in its own file —
[`src/patchwork-view-element.ts`](../src/patchwork-view-element.ts) —
and runs as a side-effect `customElements.define` call on module load:

```ts
class PatchworkView extends HTMLElement {
  get src(): string { return this.getAttribute("src") ?? ""; }
  set src(v: string | null | undefined) { reflectAttribute(this, "src", v); }
  get doc(): string { return this.getAttribute("doc") ?? ""; }
  set doc(v: string | null | undefined) { reflectAttribute(this, "doc", v); }
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

The empty `connectedMoveCallback() {}` opts the element into the
`Element.moveBefore()` lifecycle: when the platform moves a node via
`moveBefore`, it fires `connectedMoveCallback` *instead of*
`disconnectedCallback` + `connectedCallback`. Solid's `<For>` reorders
use `moveBefore` on browsers that support it; the no-op declaration
is what tells the platform "this element survives moves intact."

This is the *only* place in the system that uses `customElements`.
User views stay plain `document.createElement(name)` elements and are
never registered globally — `customElements.define` is a one-shot
ratchet that would block HMR. View identity is the element itself,
with mount state tracked in `view.ts`'s `cleanups` map (see below).

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

Move semantics today: a DOM move that the registry observes as
`removedNodes` + `addedNodes` runs `unmountView` then `mountView`,
which is "destroy + insert" semantics. The new mount re-runs the
full lifecycle (re-stamp `el.repo`, re-resolve `doc=`).

## Module layout

```
src/loader.ts             importFromAutomerge entry point, URL helpers
                          (parseAutomergeUrlWithPath, pinUrl, splitPath),
                          page-global blob cache. No DOM dependency.
src/handle.ts             Handle<T>: framework reactive primitive —
                          extends EventEmitter, value()/change(next),
                          fires "change". Plus shallowArrayEquals.
                          Currently unused by the runtime; kept for a
                          future re-introduction of context lookups.
src/branchable-repo.ts    BranchableRepo / BranchedDocHandle: forkable
                          wrapper over Repo with copy-on-write per
                          doc. Currently inert — no UI calls
                          fork/checkout/reset.
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
src/view.ts               mountView / unmountView / isView:
                          per-element lifecycle, stamps el.repo from
                          window.repo, resolves el.handle from doc=,
                          in-flight race guard via el.isConnected.
                          Owns the WeakMap<Element, cleanup | null>.
                          Exports ViewElement and MountFn.
```

`PluginRegistry` depends on the loader half of overlock for two things:

- `repo: BranchableRepo` — used to resolve folders and manifests.
  Operations that must never be branched (e.g. `findHandleInFolderHandle`
  from `@inkandswitch/patchwork-filesystem`, and `pinUrl` for module
  resolution) call into `repo.repo` directly.
- `import: (url) => Promise<unknown>` — used to fetch and evaluate
  the package's JS module as an ES module. Wired in `src/main.ts` to
  `importFromAutomerge(repo, url)` against the raw `Repo` so module
  resolution is never affected by branches.

`ViewRegistry` depends on `PluginRegistry` (for plugin loading + HMR)
only — `window.repo` is read directly in `view.ts` rather than passed
through the registry.

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
- **`doc=` requires a valid automerge URL.** An invalid URL aborts
  the mount with a logged exception. Absent, `el.handle` stays
  `undefined` and the view runs without a doc.
- **`el.repo` stamping.** Every view element has `el.repo` set
  synchronously inside `mountView` from `window.repo`. Since
  `window.repo` is set in `src/main.ts` before the view registry
  starts scanning the tree, the lookup is always populated by the
  time a view reads `el.repo`.
