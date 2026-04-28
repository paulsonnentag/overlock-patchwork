# Internals

Implementation details of the component registry, the plugin registry,
and the per-element lifecycle. Read this before changing
[`src/components/component-registry.ts`](../src/components/component-registry.ts),
[`src/components/plugin-registry.ts`](../src/components/plugin-registry.ts),
or [`src/components/component.ts`](../src/components/component.ts).

## Why `<patchwork-view>` and `<automerge-repo>` are custom elements

Two registrations live in their own files —
[`src/components/patchwork-view-element.ts`](../src/components/patchwork-view-element.ts)
and
[`src/components/automerge-repo-element.ts`](../src/components/automerge-repo-element.ts) —
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
*property* slot for the registry to write into and for components to
read out of. Putting it on a registered class instead of a plain
expando just means TypeScript / DevTools recognize it. The class also
exposes `checkout` / `fork` / `reset` mutators and a `_rebuildDescendants`
internal hook the registry installs on first sight; the mutators call
through to the hook to rebuild every component descendant whose nearest
`<automerge-repo>` ancestor is this element.

These are the *only* two places in the system that use
`customElements`. User components stay plain
`document.createElement(name)` elements and are never registered
globally — `customElements.define` is a one-shot ratchet that would
block HMR. Component identity is the element itself, with mount
state tracked in `component.ts`'s `cleanups` map (see below).

## Registry data structures

The registry doesn't track `Component` instances — there *are* no
`Component` instances. The element is the identity carrier for a
mounted component; per-element state lives in `component.ts`'s
module-private `cleanups` map. The registry's own state is just:

- **`#registry`** — `Map<string, MountFn>` for name-to-mount-fn.
  Throws on collision both on initial load and on HMR rename.
- **`#unsubUpdated`** — single unsubscribe handle for the
  `pluginRegistry.on("updated", ...)` listener installed in the
  constructor. Torn down by `destroy()`. The HMR rebuild fans out
  *one* event source to every spec the component registry cares
  about, so a per-spec listener map isn't needed.
- **`#bootstrapping`** — `WeakSet<Element>` tracking which
  `<patchwork-view>` elements have already been claimed, so a remove
  + re-add cycle on the same node doesn't kick off a duplicate load.
- **`#pendingRebuilds`** — `Set<HTMLElement>` of elements whose `doc=`
  flipped this tick. Drained on a microtask so coalesced writes
  produce a single rebuild. Stale entries (an element that was already
  rebuilt and is no longer claimed) are filtered out at flush via
  `isComponent`.

## Plugin registry

The plugin spec → `LoadedPlugin` cache and the folder subscription
that drives HMR live in `PluginRegistry`
([`src/components/plugin-registry.ts`](../src/components/plugin-registry.ts)),
not in `ComponentRegistry`. The plugin registry knows nothing about
the DOM or about component-specific shape — every plugin kind layers
its own validation on top of the generic `LoadedPlugin` shape.

`PluginRegistry` extends `EventEmitter` from `eventemitter3` and
mirrors the shape of patchwork-next's plugin registry where the
lifecycle aligns. Required `LoadedPlugin` fields are minimal:

```ts
type LoadedPlugin = {
  name: string;       // tag name (component plugins; opaque to others)
  importUrl: string;  // resolved absolute automerge: spec
  module: unknown;    // raw imported JS module
  [key: string]: unknown;  // arbitrary manifest fields preserved
};
```

The manifest JSON only has to declare `name` and `importUrl`; any
other fields are passed through opaquely so plugin kinds can add
their own required fields (`type`, `icon`, etc.) without touching
the registry. `importUrl` on the manifest is a `./`-relative
sibling reference; the registry resolves it to an absolute spec
when fetching, so the `importUrl` on the emitted `LoadedPlugin` is
always absolute (and not heads-pinned — pinning is a load-time
detail).

The public surface:

- **`load(spec)`** — `Promise<LoadedPlugin>`. Idempotent; concurrent
  calls share the in-flight promise; subsequent calls hit the cache.
  The manifest's parent folder subscription is set up on first
  load. Fires `loaded` (and `changed`) on first successful
  resolution; cache hits do not re-fire.
- **`remove(spec)`** — drops the cached entry and its folder
  subscription. Fires `removed` and `changed`. Returns `true` if the
  spec was cached.
- **`on(event, fn)`** — overrides the inherited `EventEmitter.on`
  to return an unsubscribe handle (matching patchwork-next's
  contract). Native `addListener`/`removeListener` are still
  inherited from eventemitter3 if needed.
- **`destroy()`** — drops every folder subscription, clears the
  cache, and removes all listeners. After destroy, `load` rejects.

Events:

| event     | args                                               | when |
| --------- | -------------------------------------------------- | ---- |
| `loaded`  | `(spec, plugin)`                                   | first successful load |
| `updated` | `(spec, previous, next)`                           | HMR re-fetch produced a new manifest or module |
| `removed` | `(spec)`                                           | `remove(spec)` evicted a cached entry |
| `changed` | `()`                                               | fires alongside every other event |

Patchwork-next has a `registered` event for description-only state.
We don't have an analog because `load(spec)` is the entry point;
there's no two-step register-then-load lifecycle.

The plugin registry has no opinion on what counts as an observable
change: it always fires `updated` after a successful re-fetch and
lets the consumer dedupe. The component registry's `#onPluginUpdate`
short-circuits when both `name` and `module` references are
unchanged — that's a defensive check against spurious folder
events, not the main optimization path.

Per-element state — the cleanups map keyed by element — sits in
[`component.ts`](../src/components/component.ts) as
`WeakMap<Element, cleanup | null>`. `WeakMap` so the map never keeps
DOM nodes alive on its own. `mountComponent` claims an entry
synchronously; `unmountElement` drains it; `isComponent(el)` answers
"is this element currently a component?" for the registry's own dedup.

The cleanups map is process-wide on purpose: two `ComponentRegistry`
instances over disjoint subtrees never see each other's elements. On
overlapping subtrees they would conflict — which is the same answer
either way.

## Module layout

```
src/types.ts              ComponentManifest, MountFn, ComponentRoot
src/subscribable.ts       Subscribable<T> interface +
                          BasicSubscribable<T> default impl;
                          framework reactive primitive
src/components/
  plugin-registry.ts      PluginRegistry: spec -> LoadedPlugin load
                          cache, per-spec folder subscription,
                          eventemitter3 events (loaded/updated/
                          removed/changed). No DOM dependency.
  component-registry.ts   ComponentRegistry: DOM observer, name
                          table, <patchwork-view> bootstrap, swapTag,
                          microtask-batched doc= rebuild, HMR rebuild
                          via pluginRegistry.on("updated", ...)
  patchwork-view-element.ts
                          PatchworkView class +
                          customElements.define; src/doc reflection,
                          lazy property upgrade, connectedMoveCallback
  automerge-repo-element.ts
                          AutomergeRepoElement class +
                          customElements.define; .repo property,
                          checkout/fork/reset mutators
  component.ts            mountComponent / unmountElement /
                          isComponent: per-element lifecycle, doc-
                          context resolution, el.repo stamping,
                          in-flight race guard via el.isConnected.
                          Owns the WeakMap<Element, cleanup | null>.
  index.ts                public re-exports
```

`PluginRegistry` depends on the loader half of overlock for two things:

- `repo: BranchableRepo` — used to resolve folders, manifests, and read
  `.heads()` for pinning. The wrapper passes through to the underlying
  `Repo` while unbranched, so plugin loading doesn't care about the
  branch state. Operations that must never be branched (e.g.
  `findHandleInFolderHandle` from `@inkandswitch/patchwork-filesystem`)
  call into `repo.repo` directly.
- `automergeImport: (spec) => Promise<unknown>` — used to fetch and
  evaluate `component.js` as an ES module. Always runs against the raw
  `Repo` so module resolution is never affected by branches.

`ComponentRegistry` depends on `PluginRegistry` (for plugin loading +
HMR) and `BranchableRepo` (for the `<automerge-repo>` marker fallback).
It does *not* see `automergeImport` directly.

Both registries are wired up in [`src/main.ts`](../src/main.ts).

## Constraints and limits

- **Tag names need a hyphen.** Enforced when reading the manifest.
  Matches the HTML custom-element naming rule and avoids accidental
  collisions with built-ins.
- **Manifest `url` must start with `./`.** Cross-package and bare
  specifiers in the manifest are rejected so HMR's pinning semantics
  stay obvious — the JS module always lives in the same folder doc
  as its manifest.
- **No namespaces yet.** Component name collisions throw immediately,
  both on initial load and on HMR rename.
- **`doc=` requires `<automerge-repo>`.** Setting `doc=` on a
  `<patchwork-view>` outside any `<automerge-repo>` ancestor is an
  error; the mount is aborted with a logged exception. Components
  that don't need a doc (e.g. `clock`) work fine with no scope.
- **`el.repo` stamping.** Every component element has `el.repo` set
  synchronously inside `mountComponent` from
  `el.closest("automerge-repo")`. Outside any `<automerge-repo>`
  ancestor, `el.repo` is `undefined` and the component is responsible
  for handling that gracefully. The `<automerge-repo>` marker's `repo`
  property is stamped by the registry's tree-order initial walk before
  any descendant `<patchwork-view>` bootstraps, so the lookup is
  always populated by the time a component reads `el.repo`.
