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

`packages/root/` is a tiny doc-backed counter. Its mount fn finds or
creates a counter document via `element.repo`, stores the URL in
`localStorage`, and renders a button that bumps `count` via
`handle.change`.

Push the packages to the configured Subduction backend with:

```
pnpm push packages
```

This calls [`pushwork`](../pushwork) for each subfolder and writes
`packages/<name>/.pushwork/snapshot.json` containing each package's
`rootDirectoryUrl`. To run the demo end-to-end:

1. Run `pnpm push packages` once.
2. Copy `packages/root/.pushwork/snapshot.json`'s `rootDirectoryUrl`
   into the `<patchwork-view src="...">` placeholder in
   [`index.html`](./index.html).
3. Open `index.html` in a browser.

Editing `packages/root/component.js` + re-running `pnpm push packages`
hot-reloads the live page.

## Architecture

Documentation lives in [`docs/`](./docs):

- [`docs/README.md`](./docs/README.md) — index, glossary, file map.
- [`docs/loader.md`](./docs/loader.md) — `importFromAutomerge`, blob URLs,
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
