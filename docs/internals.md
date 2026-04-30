# Internals

Implementation notes for the registries and per-element lifecycle.
Read this before changing
[`src/view-registry.ts`](../src/view-registry.ts),
[`src/plugin-registry.ts`](../src/plugin-registry.ts), or
[`src/view.ts`](../src/view.ts).

## Built-in custom elements

One registration lives in its own file and runs as a side-effect
`customElements.define` call on import:

- `<patchwork-view>` — [`src/patchwork-view-element.ts`](../src/patchwork-view-element.ts).

Autonomous (extends `HTMLElement` directly) and doesn't go through
`mountView`. Reflects `src` and `doc` JS properties back to
attributes (Solid/Lit-style frameworks write property slots), runs
the standard "lazy property upgrade" dance for `<template>` clones,
and declares an empty `connectedMoveCallback()` to opt into
`Element.moveBefore()`.

Context is *not* a registered element — it's a duck-typed shape
(any custom-tag ancestor exposing a `.value`). See
[`context.md`](./context.md) and the `defineContext` helper.

User views stay plain `document.createElement(name)` elements and are
never registered globally — `customElements.define` is a one-shot
ratchet that would block HMR. View identity is the element itself.

## Registry data structures

There are no `View` instances. Per-element state lives in
`view.ts`'s module-private `WeakMap<Element, ViewState>` where
`ViewState = { mounted: Promise<void>; cleanup: (() => void) | null }`.
`WeakMap` so the map never keeps DOM nodes alive on its own.

The registry's own state in `view-registry.ts`:

- **`#viewsByTag`** — `Map<string, MountFn>`. Throws on collision.
- **`#onPluginUpdate`** — listener installed on the plugin registry
  in the constructor with `{ signal }` from `#abort`.
- **`#claimedViews`** — `WeakSet<Element>` so a remove + re-add on
  the same node doesn't kick off a duplicate load.
- **`#pendingRebuilds`** — elements whose `doc=` flipped this tick.
  Drained on a microtask; stale entries filtered via `isView`.
- **`#abort`** — `AbortController` for all listener teardown in
  `destroy()`.

`walkStoppingAtViews` is the single tree walk used for the initial
scan, every `addedNodes` MO record, and the post-mount cascade. It
recurses only into elements that aren't view boundaries (not
`<patchwork-view>`, not in the views map). That single rule produces
the top-down mount order.

## Plugin registry

Lives in [`src/plugin-registry.ts`](../src/plugin-registry.ts). Knows
nothing about the DOM or about view-specific shape — every plugin
kind layers its own validation. Extends `EventTarget` and dispatches
`CustomEvent`s; bridges to `automerge-repo`'s upstream
`EventEmitter`-shaped folder handles with `.on/.off`.

```ts
type LoadedPlugin = {
  name: string;
  importUrl: string;       // resolved absolute automerge: URL
  module: unknown;
  [key: string]: unknown;  // arbitrary manifest fields preserved
};
```

Public surface:

- **`load(url)`** — `Promise<LoadedPlugin>`. Idempotent; concurrent
  calls share an in-flight promise; cache hits don't re-fire events.
- **`remove(url)`** — drops cache + folder subscription.
- **`destroy()`** — clears everything; subsequent `load` rejects.

Events: `loaded`, `updated`, `removed` (`CustomEvent` with detail);
`changed` fires alongside every other event (plain `Event`).

The registry has no opinion on what counts as observable change —
always fires `updated` after a successful re-fetch and lets the
consumer dedupe. The view registry's `#onPluginUpdate` short-circuits
when both `name` and the `module` reference are unchanged.

A "plugin URL" is `automerge:<docId>/<path/to/manifest.json>`. The
manifest's `importUrl` must be `./`-relative; the registry resolves
it to absolute (and not heads-pinned — pinning is a load-time
detail).

## Module dependencies

See the file map in [`README.md`](./README.md) for what each module
owns. Notable dependencies:

`PluginRegistry` depends on the loader half for two things: a
`BranchableRepo` (folder/manifest resolution; operations that must
never be branched call into `repo.repo` directly) and an `import`
function wired in `main.ts` to a `Loader` instance constructed against
the raw `Repo`.

`ViewRegistry` depends on `PluginRegistry`. `window.repo` is read
directly in `view.ts`.

## Constraints

- Tag names need a hyphen. Enforced when reading the manifest.
- Manifest `importUrl` must start with `./`.
- View name collisions throw — both at initial load and on HMR
  rename.
- `doc=` requires a valid automerge URL or the mount is aborted.
- `el.repo` is stamped inside `mount()` after the ancestor barrier,
  before the user mount fn runs. Always populated — the bootstrap
  installs a page-level repo provider on `<body>`.
- `<patchwork-view>` carries only `src` and `doc`. `swapTag` copies
  only `doc=` to the user's tag.
- Top-down failure propagates: an ancestor's failed mount leaves
  its descendants unmounted rather than partially populated.
- DOM moves observed as `removedNodes` + `addedNodes` are
  destroy + insert (full re-stamp of `el.repo`, re-resolve `doc=`).
