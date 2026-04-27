# Internals

Implementation details of the component registry. Read this before
changing
[`src/components/component-registry.ts`](../src/components/component-registry.ts)
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
block HMR. Component identity instead lives in the registry's data
structures (see below).

## Registry data structures

The registry's identity tracking is split across a process-wide store
and three per-`ComponentRegistry` collections:

- **`componentStore`** — a process-wide `WeakMap<Element, Component>`
  for element-to-instance lookup. Lives in
  [`component-store.ts`](../src/components/component-store.ts).
  `WeakMap` so the store never keeps DOM nodes alive on its own.
  Components unregister themselves on `unmount()`; entries for
  GC'd elements vanish with them.
- **`#registry`** — `Map<string, MountFn>` for name-to-mount-fn.
  Throws on collision both on initial load and on HMR rename.
- **`#mounted`** — `Set<Component>` for iteration on HMR teardown
  and `destroy()`.
- **`#loaded` / `#loading`** — manifest spec → `LoadedComponent` (and
  in-flight promise dedup). Each unique manifest spec has exactly one
  HMR subscription.
- **`#bootstrapping`** — `WeakSet<Element>` tracking which
  `<patchwork-view>` elements have already been claimed, so a remove
  + re-add cycle on the same node doesn't kick off a duplicate load.

Two `ComponentRegistry` instances over disjoint subtrees never see
each other's elements. On overlapping subtrees they would conflict —
which is the same answer either way.

## Module layout

```
src/types.ts              ComponentManifest, MountFn, Schema,
                          ComponentRoot, SchemaComponentRoot
src/components/
  component-registry.ts   ComponentRegistry: DOM observer, manifest
                          fetch, HMR, swapTag, microtask-batched
                          doc= rebuild
  patchwork-view-element.ts
                          PatchworkView class +
                          customElements.define; src/doc reflection,
                          lazy property upgrade, connectedMoveCallback
  automerge-repo-element.ts
                          AutomergeRepoElement class +
                          customElements.define; .repo property,
                          checkout/fork/reset mutators
  component.ts            Component lifecycle: async mount, cleanup,
                          generation guard
  component-store.ts      Singleton WeakMap<Element, Component>
  ancestor-lookup.ts      closestComponent / ancestorComponent /
                          componentChildren walkers, element method
                          stamping (also stamps el.repo from closest
                          <automerge-repo>)
  index.ts                public re-exports
```

The registry depends on the loader half of overlock for two things:

- `repo: BranchableRepo` — used to resolve folders, manifests, and read
  `.heads()` for pinning. The wrapper passes through to the underlying
  `Repo` while unbranched, so the registry doesn't care about the
  branch state. Operations that must never be branched (e.g.
  `findHandleInFolderHandle` from `@inkandswitch/patchwork-filesystem`)
  call into `repo.repo` directly.
- `automergeImport: (spec) => Promise<unknown>` — used to fetch and
  evaluate `component.js` as an ES module. Always runs against the raw
  `Repo` so module resolution is never affected by branches.

Both are wired up in [`src/main.ts`](../src/main.ts) and exposed
through `window.createComponentRegistry(root)`.

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
- **Ancestor lookups race `doc=` resolution.** `closestComponent` /
  `ancestorComponent` are synchronous snapshots of `componentStore`.
  Tree-order construction guarantees a parent's `Component` is
  registered before its children construct, but `el.handle` is set
  asynchronously, so a schema-filtered walk run from a child mount fn
  can briefly miss a parent that is still resolving. Documented in
  [`documents.md`](./documents.md#race-against-doc-resolution); call
  the lookup from a reactive scope when the result must be live.
- **Child-component lookups race bootstrap.** `componentChildren()`
  reports both already-swapped components and still-bootstrapping
  `<patchwork-view>` elements as boundaries, so providers can write
  `doc=` on each immediately and let the registry's bootstrap or
  rebuild path pick the value up. Children that are added to the DOM
  *after* the provider runs are not picked up automatically; consumers
  that need to react to dynamic structural changes must run their own
  `MutationObserver` or call `componentChildren()` from a reactive
  scope re-run by their own state updates.
- **`el.repo` stamping.** Every component element has `el.repo` set
  at construction time from `el.closest("automerge-repo")`. Outside
  any `<automerge-repo>` ancestor, `el.repo` is `undefined` and the
  component is responsible for handling that gracefully. The
  `<automerge-repo>` marker's `repo` property is stamped by the
  registry's tree-order initial walk before any descendant
  `<patchwork-view>` bootstraps, so the lookup is always populated by
  the time a component reads `el.repo`.
- **Structural-only schema matching.** Components don't register their
  schemas with the framework. `closestComponent(schema)` walks ancestors
  and returns the first whose `handle.doc()` parses under the schema —
  any duck-equivalent doc is a hit. The framework never calls
  `schema.init()`; that's reserved for the consumer's own bootstrap
  logic.
