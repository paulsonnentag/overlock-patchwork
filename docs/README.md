# Architecture

Two layers stacked, both in `src/`:

1. **Loader** — resolve `automerge:` URLs against the in-page Repo,
   rewrite imports, `import()` as a blob URL.
2. **View runtime** — `<patchwork-view>` bootstrap, DOM observer, and
   per-element mount/unmount with HMR.

Each doc below is a short pointer into the relevant source files.
Read the source for the full picture; these pages just orient you.

- [`guide.md`](./guide.md) — tutorial: mount fn, views, context,
  `doc=` propagation, intent events.
- [`loader.md`](./loader.md) — `src/loader.ts`, `src/main.ts` (wasm).
- [`components.md`](./components.md) — package layout, manifest,
  mount-fn contract, embedding `<patchwork-view>`.
- [`documents.md`](./documents.md) — `window.repo`, `doc=`,
  `el.handle`, branching.
- [`context.md`](./context.md) — context provider / consumer
  (`defineContext` helper, ancestor walk).
- [`lifecycle.md`](./lifecycle.md) — top-down mount sequence, HMR,
  race handling.
- [`internals.md`](./internals.md) — registry internals, module
  layout, constraints.

## Glossary

- **Component package.** Folder doc with a JSON manifest + JS module.
  Pushed independently by `pushwork`; each gets a stable
  `rootDirectoryUrl`. Files are named after the package by convention
  so cross-package URLs self-describe.
- **Library package.** Same shape, no manifest — imported by other
  packages via `automerge:` URLs.
- **Manifest.** `{ name, importUrl }` plus arbitrary opaque fields.
  `name` is the custom tag (must contain a hyphen). `importUrl` is
  `./`-relative.
- **Mount fn.** Default export of the JS module:
  `(el: ViewElement) => Promise<(() => void) | void>`. `ViewElement`
  is `HTMLElement` plus optional `el.handle`, `el.repo`, and
  `el.context(predicate)` for stacked-context lookup. See
  `src/view.ts`.
- **Bootstrap tag.** `<patchwork-view src=...>`. The only hard-coded
  mount tag. Carries `src` and `doc` only.
- **Repo.** A single `BranchableRepo` at `window.repo`, stamped onto
  every view as `el.repo`. See `src/branchable-repo.ts`.
- **Plugin registry.** pluginUrl → `LoadedPlugin` cache + folder
  subscription for HMR. `EventTarget`, dispatches
  `loaded`/`updated`/`removed`/`changed`. See `src/plugin-registry.ts`.
- **View registry.** Per-root DOM observer + tag-name table.
  Delegates plugin loading to the plugin registry. See
  `src/view-registry.ts`. Per-element state lives in `src/view.ts`.
- **Top-down mounting.** A view's mount fn awaits its closest
  ancestor view's `mounted` promise before resolving `doc=` or
  running. The post-mount cascade walks the now-static children.
  See [`lifecycle.md`](./lifecycle.md).
- **Context.** Any custom-element ancestor (tag name with a hyphen)
  exposing a `value` property. Descendants find one via
  `el.context(predicate)`, which walks up filtering by the dash rule
  and the predicate. Authored with `defineContext` from the helper
  package — wraps a regular mount fn and installs `value` / `source`
  / `change` machinery on the host element.

## File map

| Path | Role |
| --- | --- |
| [`src/main.ts`](../src/main.ts) | bootstrap: wasm init, Repo, registries on `document.body` |
| [`src/branchable-repo.ts`](../src/branchable-repo.ts) | `BranchableRepo` — forkable wrapper over `Repo` with copy-on-write |
| [`src/loader.ts`](../src/loader.ts) | `Loader` class (`import`, `setPackagesRoot`) + URL helpers (`parseAutomergeUrlWithPath`, `pinUrl`, `splitPath`) |
| [`src/plugin-registry.ts`](../src/plugin-registry.ts) | pluginUrl → manifest+module cache, HMR via folder subscription |
| [`src/view-registry.ts`](../src/view-registry.ts) | DOM observer, tag-name table, `<patchwork-view>` bootstrap, top-down walk + cascade, `doc=` rebuild |
| [`src/patchwork-view-element.ts`](../src/patchwork-view-element.ts) | `<patchwork-view>` custom element: `src`/`doc` reflection, lazy upgrade |
| [`src/view.ts`](../src/view.ts) | `mountView`/`unmountView`/`isView`/`viewMounted`: per-element lifecycle, ancestor barrier, race guard. Stamps `el.repo` and `el.context` (stacked-context walk via dash + `value`). Owns `WeakMap<Element, ViewState>`. |
| [`packages/context/context.js`](../packages/context/context.js) | `defineContext`: wrap a mount fn so the host element publishes a `value` to descendants |
| [`src/handle.ts`](../src/handle.ts) | `Handle<T>` reactive primitive — `EventTarget`, `value` getter, `change(next)` writer |
