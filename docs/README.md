# Architecture

overlock-patchwork is two layers stacked:

1. **Loader.** Resolve `automerge:` URLs against the in-page Repo,
   rewrite every import in the source, and `import()` the rewritten
   module as a blob URL. Lives in `src/`.
2. **View runtime.** A `<patchwork-view>` bootstrap tag, a registry
   that watches the DOM, and a per-element mount/unmount lifecycle
   with HMR. Lives in `src/`.

Start with the doc closest to the change you want to make.

- [`loader.md`](./loader.md) — `importFromAutomerge`, blob URLs, package
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

## Glossary

- **Component package.** A folder document containing a JSON manifest
  and the file the manifest's `importUrl` points at. Both files are
  named after the package by convention (`folder-list.json` +
  `folder-list.js`, not `component.json` + `component.js`) so that
  cross-package URLs of the form `automerge:<rootDirectoryUrl>/<file>`
  self-describe their target — the names are not required by the
  loader. Pushed independently with `pushwork`, so each package has
  a stable `rootDirectoryUrl` that can be referenced from other
  packages or pages. The on-disk artifact is called a *component
  package* even though the runtime mounts it as a *view*.
- **Library package.** A package without a manifest — just a folder of
  JS files imported by other packages via
  `import … from "automerge:<rootDirectoryUrl>/<file>"`. Manifests are
  only needed for views that get bootstrapped through
  `<patchwork-view src=>`. `packages/solid-helpers` is the example.
- **Manifest.** A JSON document. The plugin registry only requires
  `{ name, importUrl }`; arbitrary additional fields are passed
  through opaquely. `name` is the custom tag name the view will mount
  under (must contain a hyphen, per HTML custom-element rules).
  `importUrl` is a `./`-relative path to the JS module; the registry
  resolves it to an absolute automerge URL at load time.
- **Mount fn.** The default export of the package's JS module. An async
  function that gets the host element and returns an optional
  cleanup — equivalent to
  `(element: ViewElement) => Promise<(() => void) | void>`.
  `ViewElement` is `HTMLElement` plus an optional `handle` and `repo`,
  and the contextual `closestView` / `ancestorView` / `childViews`
  lookups. See [`documents.md`](./documents.md).
- **Bootstrap tag.** `<patchwork-view src="automerge:.../<name>.json">`.
  The registry's only hard-coded mount tag. See
  [`components.md`](./components.md).
- **Repo scope.** `<automerge-repo>` is a marker tag. The registry
  stamps a `BranchableRepo` reference onto every `<automerge-repo>` it
  discovers; descendant `<patchwork-view doc=...>` elements look it up
  via `closest("automerge-repo").repo`. `BranchableRepo` is a thin
  forkable wrapper around the underlying Automerge `Repo` (see
  [`documents.md`](./documents.md#branching) and
  [`src/branchable-repo.ts`](../src/branchable-repo.ts)).
- **Plugin registry.** A pluginUrl → `LoadedPlugin` cache with one
  folder subscription per URL driving HMR. Extends `EventEmitter`
  (`eventemitter3`) and emits `loaded` / `updated` / `removed` /
  `changed` events. The view registry consumes `load(url)` and
  `on("updated", ...)`; the plugin registry knows nothing about the
  DOM or about the view-specific shape. See
  [`internals.md`](./internals.md).
- **View registry.** A per-root orchestrator owning a
  `MutationObserver` and the tag-name table. Delegates plugin loading
  + HMR to the plugin registry. Per-element instance state lives in
  `view.ts`'s module-private `cleanups` map, not on the registry.
  See [`internals.md`](./internals.md).
- **Race guarantee for in-flight mounts.** `mountView` reads
  `el.isConnected` after each `await`. If the element disconnected
  while the mount fn was in flight, the returned cleanup runs
  immediately and is discarded rather than installed. The element is
  the identity carrier — there is no separate View instance to
  signal. See [`lifecycle.md`](./lifecycle.md).

## File map

| Path | Role |
| --- | --- |
| [`src/main.ts`](../src/main.ts) | bootstrap: base64-inline wasm init, Repo, `BranchableRepo` wrap, `PluginRegistry` + `ViewRegistry` mount on `document.body` |
| [`src/branchable-repo.ts`](../src/branchable-repo.ts) | `BranchableRepo` / `BranchedDocHandle`: forkable wrapper over `Repo` with copy-on-write per doc |
| [`src/loader.ts`](../src/loader.ts) | `importFromAutomerge`: resolve → parse → rewrite → blob URL → `import()`. Also exports `parseAutomergeUrlWithPath`, `pinUrl`, `splitPath`. |
| [`src/plugin-registry.ts`](../src/plugin-registry.ts) | `PluginRegistry`: pluginUrl → manifest + module load cache, per-URL folder subscription for HMR, `loaded`/`updated`/`removed`/`changed` events |
| [`src/view-registry.ts`](../src/view-registry.ts) | `ViewRegistry`: DOM observer, tag-name table, `<patchwork-view>` bootstrap, `swapTag`, microtask-batched `doc=` rebuild, HMR rebuild via `pluginRegistry.on("updated", ...)` |
| [`src/patchwork-view-element.ts`](../src/patchwork-view-element.ts) | `PatchworkView` autonomous custom element: `src`/`doc` reflection, lazy property upgrade |
| [`src/automerge-repo-element.ts`](../src/automerge-repo-element.ts) | `AutomergeRepoElement` scope marker: `.repo` property, `checkout`/`fork`/`reset` mutators |
| [`src/view.ts`](../src/view.ts) | `mountView` / `unmountView` / `isView`: per-element lifecycle, doc-context resolution, race guard via `isConnected`, `el.repo` + scope stamping, `closestView`/`ancestorView`/`childViews` install. Owns the `WeakMap<Element, cleanup \| null>`. Exports the `ViewElement`, `SchemaViewElement`, and `MountFn` types. |
| [`src/scope.ts`](../src/scope.ts) | `Scope`: per-view node in the schema-indexed lookup tree backing `closestView` / `ancestorView` / `childViews`. Owns the engine state, registered-schema set, and per-scope `closest`/`findChildren` `Handle`s. |
| [`src/handle.ts`](../src/handle.ts) | `Handle<T>`: framework reactive primitive — extends `EventEmitter`, `value()` reader, `change(next)` writer, fires `change` events. Plus `shallowArrayEquals` for list-shaped views. |
