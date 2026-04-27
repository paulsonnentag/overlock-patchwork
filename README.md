# overlock-patchwork

Load Automerge-stored ES modules as live DOM components. The bundle is
a single JS file you can open under `file://` — no service worker, no
dev server. wasm for both `@automerge/automerge` and
`@automerge/automerge-subduction` is base64-inlined into the bundle.

The page boots a [`Repo`](https://automerge.org/automerge-repo/) over
Subduction, exposes a tiny `automergeImport(spec)` loader, and runs a
`<patchwork-view>`-driven component registry with HMR.

## Build

```
pnpm install
pnpm build
```

Produces `dist/overlock.js` (~5.8 MB unminified, ~2 MB gzipped).
Open `index.html` in a browser — no static host required.

## Quick demo

`packages/` contains a basic document-editor demo composed from
several components: an outer `app-frame` (account / selection state),
a `root` layout, `root-folder-context` and `selected-doc-context`
context-providers, a `folder-list`, a `new-markdown-button`,
`doc-title`, `markdown-editor`, and `url-sync`. Together they show off
context-provider components built on top of `componentChildren()`.

Push the packages to the configured Subduction backend with:

```
pnpm push packages
```

This calls [`pushwork`](../pushwork) for each subfolder and writes
`packages/<name>/.pushwork/snapshot.json` containing each package's
`rootDirectoryUrl`. To run the demo end-to-end:

1. Run `pnpm push packages` once.
2. Copy `packages/root/.pushwork/snapshot.json`'s `rootDirectoryUrl`
   into the `ROOT_SRC` constant at the top of
   [`packages/app-frame/component.js`](./packages/app-frame/component.js).
   Wire each remaining sibling URL into the matching constants at the
   top of [`packages/root/component.js`](./packages/root/component.js)
   (already populated for the current snapshot).
3. Copy `packages/app-frame/.pushwork/snapshot.json`'s
   `rootDirectoryUrl` into the placeholder in
   [`index.html`](./index.html).
4. Re-run `pnpm push packages` so the updated `app-frame` ships.
5. Open `index.html` in a browser.

Editing `packages/<name>/component.js` + re-running `pnpm push packages`
hot-reloads the live page.

## Architecture

Documentation lives in [`docs/`](./docs):

- [`docs/README.md`](./docs/README.md) — index, glossary, file map.
- [`docs/loader.md`](./docs/loader.md) — `automergeImport`, blob URLs,
  package exports, heads pinning, wasm bootstrap.
- [`docs/components.md`](./docs/components.md) — package layout,
  manifest schema, mount-fn contract, embedding `<patchwork-view>`,
  composition.
- [`docs/documents.md`](./docs/documents.md) — `<automerge-repo>`
  scope, `doc=` attribute, `el.handle`, reactive doc rebuilds.
- [`docs/lifecycle.md`](./docs/lifecycle.md) — mount/unmount sequence
  diagram, HMR semantics, generation guard, race handling.
- [`docs/internals.md`](./docs/internals.md) — registry data
  structures, custom-element rationale, module layout, constraints.
