# Architecture

overlock-patchwork is two layers stacked:

1. **Loader.** Resolve `automerge:` URLs against the in-page Repo,
   rewrite every import in the source, and `import()` the rewritten
   module as a blob URL. Lives in `src/`.
2. **Component runtime.** A `<patchwork-view>` bootstrap tag, a
   registry that watches the DOM, and a `Component` lifecycle with
   HMR. Lives in `src/components/`.

Start with the doc closest to the change you want to make.

- [`loader.md`](./loader.md) — `automergeImport`, blob URLs, package
  exports, heads pinning, wasm bootstrap.
- [`components.md`](./components.md) — package layout, manifest
  schema, mount-fn contract, embedding `<patchwork-view>`, composition.
- [`documents.md`](./documents.md) — `<automerge-repo>` scope, `doc=`
  attribute, `el.handle`, reactive doc rebuilds.
- [`lifecycle.md`](./lifecycle.md) — mount/unmount sequence diagram,
  HMR semantics, state-machine race handling, microtask-batched
  `doc=` rebuilds.
- [`internals.md`](./internals.md) — registry data structures,
  custom-element rationale, module layout, constraints.

For *planned* (not-yet-implemented) work, see
[`design/`](./design/README.md). Architecture docs above describe
behavior the code actually has; design notes describe shapes we're
considering and may not ship.

## Glossary

- **Component package.** A folder document containing `component.json`
  (the manifest) and the file the manifest points at — typically
  `component.js`. Pushed independently with `pushwork`, so each package
  has a stable `rootDirectoryUrl` that can be referenced from other
  components or pages.
- **Manifest.** A JSON document with `{ name, url }`. `name` is the
  custom tag name the component will mount under (must contain a
  hyphen, per HTML custom-element rules). `url` is a `./`-relative
  path to the JS module.
- **Mount fn.** The default export of `component.js`. An async
  function that gets the host element and returns an optional
  cleanup — equivalent to
  `(element: ComponentRoot) => Promise<(() => void) | void>`.
  `ComponentRoot` is `HTMLElement` plus an optional `handle` and the
  ancestor-walk methods `closestComponent` / `ancestorComponent`. See
  [`documents.md`](./documents.md#looking-up-ancestor-components).
- **Schema.** Duck-typed `{ init(): T; parse(value): T }` interface.
  Consumers pass one to `closestComponent` / `ancestorComponent` to
  filter ancestors by structural match against their `handle.doc()`.
  `init` is for consumer bootstrap logic; the framework never calls it.
- **Bootstrap tag.** `<patchwork-view src="automerge:.../component.json">`.
  The registry's only hard-coded mount tag. See
  [`components.md`](./components.md).
- **Repo scope.** `<automerge-repo>` is a marker tag. The registry
  stamps a `BranchableRepo` reference onto every `<automerge-repo>` it
  discovers; descendant `<patchwork-view doc=...>` elements look it up
  via `closest("automerge-repo").repo`. `BranchableRepo` is a thin
  forkable wrapper around the underlying Automerge `Repo` (see
  [`documents.md`](./documents.md#branching) and
  [`src/branchable-repo.ts`](../src/branchable-repo.ts)).
- **Component registry.** A per-root orchestrator owning a
  `MutationObserver`, the bootstrap-load cache, the name table, and
  the set of mounted instances. See [`internals.md`](./internals.md).
- **Component state.** A four-value lifecycle on `Component`:
  `idle → mounting → mounted → unmounted`. `unmount()` while the
  state is `mounting` makes the eventual mount-fn cleanup run
  immediately on resolve rather than be installed — that's the race
  guarantee for in-flight mounts. See [`lifecycle.md`](./lifecycle.md).

## File map

| Path | Role |
| --- | --- |
| [`src/main.ts`](../src/main.ts) | bootstrap: base64-inline wasm init, Repo, `BranchableRepo` wrap, `ComponentRegistry` mount on `document.body` |
| [`src/branchable-repo.ts`](../src/branchable-repo.ts) | `BranchableRepo` / `BranchedDocHandle`: forkable wrapper over `Repo` with copy-on-write per doc |
| [`src/automerge-import.ts`](../src/automerge-import.ts) | resolve → parse → rewrite → blob URL → `import()` |
| [`src/resolve.ts`](../src/resolve.ts) | folder walk + `package.json` `exports` lookup |
| [`src/components/component-registry.ts`](../src/components/component-registry.ts) | DOM observer, manifest fetch, HMR, `swapTag`, microtask-batched `doc=` rebuild |
| [`src/components/patchwork-view-element.ts`](../src/components/patchwork-view-element.ts) | `PatchworkView` autonomous custom element: `src`/`doc` reflection, lazy property upgrade |
| [`src/components/automerge-repo-element.ts`](../src/components/automerge-repo-element.ts) | `AutomergeRepoElement` scope marker: `.repo` property, `checkout`/`fork`/`reset` mutators |
| [`src/components/component.ts`](../src/components/component.ts) | `Component` lifecycle: state enum, teardown set, in-flight race guard |
| [`src/components/component-store.ts`](../src/components/component-store.ts) | `WeakMap<Element, Component>` lookup |
| [`src/components/ancestor-lookup.ts`](../src/components/ancestor-lookup.ts) | `closestComponent` / `ancestorComponent` / `componentChildren` walkers, element method stamping (returns `Subscribable<...>`; also stamps `el.repo`) |
| [`src/subscribable.ts`](../src/subscribable.ts) | `Subscribable<T>` interface + `BasicSubscribable<T>` default impl: framework reactive primitive |
| [`src/types.ts`](../src/types.ts) | `ComponentManifest`, `MountFn`, `Schema`, `ComponentRoot`, `SchemaComponentRoot` |
| [`src/components/index.ts`](../src/components/index.ts) | public re-exports |
