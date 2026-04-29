# overlock-patchwork

Load Automerge-stored ES modules as live DOM components. The bundle is
a single JS file you can open under `file://` — no service worker, no
dev server. wasm for both `@automerge/automerge` and
`@automerge/automerge-subduction` is base64-inlined into the bundle.

The page boots a [`Repo`](https://automerge.org/automerge-repo/) over
Subduction, exposes a tiny `importFromAutomerge(repo, url)` loader, and
runs a `<patchwork-view>`-driven component registry with HMR.

## Build

```
pnpm install
pnpm build
```

Produces `dist/overlock.js` (~5.8 MB unminified, ~2 MB gzipped).
Open `index.html` in a browser — no static host required.

## Quick demo

`packages/` ships a minimal `app-frame` view: a counter that stores
its `count` in an Automerge doc. The doc URL is persisted in
`localStorage` so the value survives reloads. The other packages
under `packages/` (`root`, `folder-list`, `branch-picker`,
`*-context`, …) depend on a contextual lookup API that has been
removed, and don't currently mount.

Push the packages to the configured Subduction backend with:

```
pnpm push packages
```

This calls [`pushwork`](../pushwork) for each subfolder and writes
`packages/<name>/.pushwork/snapshot.json` containing each package's
`rootDirectoryUrl`. To run the demo end-to-end:

1. Run `pnpm push packages` once.
2. Copy `packages/app-frame/.pushwork/snapshot.json`'s
   `rootDirectoryUrl` into the `<patchwork-view src="...">`
   placeholder in [`index.html`](./index.html), keeping the
   `/app-frame.json` path component (the manifest filename).
3. Open `index.html` in a browser.

Cross-package URLs stay stable across subsequent pushes — pushwork
preserves each package's `rootDirectoryUrl`. Editing
`packages/app-frame/app-frame.js` and re-running `pnpm push packages`
hot-reloads the live page.

## Architecture

Documentation lives in [`docs/`](./docs):

- [`docs/README.md`](./docs/README.md) — index, glossary, file map.
- [`docs/loader.md`](./docs/loader.md) — `importFromAutomerge`, blob URLs,
  package exports, heads pinning, wasm bootstrap.
- [`docs/components.md`](./docs/components.md) — package layout,
  manifest schema, mount-fn contract, embedding `<patchwork-view>`,
  composition.
- [`docs/documents.md`](./docs/documents.md) — `window.repo`, `doc=`
  attribute, `el.handle`, reactive doc rebuilds.
- [`docs/context.md`](./docs/context.md) — `<patchwork-context>` for
  sharing values down a subtree.
- [`docs/lifecycle.md`](./docs/lifecycle.md) — top-down mount/unmount
  sequence diagram, ancestor-await barrier, HMR semantics, race
  handling.
- [`docs/internals.md`](./docs/internals.md) — registry data
  structures, custom-element rationale, module layout, constraints.
