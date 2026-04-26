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

`packages/` contains four example components: `clock`, `counter`,
`hello`, and a `demo-app` that composes the others. Push them all to
the configured Subduction backend with:

```
pnpm push packages
```

This calls [`pushwork`](../pushwork) for each subfolder and writes
`packages/<name>/.pushwork/snapshot.json` containing each package's
`rootDirectoryUrl`. Drop a URL into `<patchwork-view src="...">` in
[`index.html`](./index.html), open the file in a browser, and edit
`packages/<name>/component.js` + re-run `pnpm push packages` to see
HMR pick up the change.

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
