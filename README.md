# overlock

Load ES modules out of [Automerge](https://automerge.org) folder documents at
runtime via blob URLs. No service worker, no dev server — the bundle is a
single JS file that you can open under `file://`. The wasm for both
`@automerge/automerge` and `@automerge/automerge-subduction` is base64-inlined
into that bundle.

This is a stripped-down equivalent of the loader half of
[`patchwork-next`](../patchwork-next): instead of intercepting `fetch` from a
service worker (`core/bootloader/src/service-worker.ts`) and returning real
HTTP responses, overlock walks the same folder/file documents in the page,
rewrites every `import` specifier in the source to a sibling blob URL, and
dynamically imports the resulting blob.

## Layout

```
src/
  main.ts             entry — boots Repo over Subduction, exposes globals
  wasm-loader.ts      base64 -> Uint8Array -> initializeWasm / initSync
  automerge-import.ts resolve → parse → rewrite imports → blob URL → import()
  resolve.ts          findHandleInFolderHandle + package.json exports lookup
  types.ts            FolderDoc / FileDoc shapes used by pushwork
modules/
  hello/              proof-of-concept payload pushed via pushwork
index.html            single static page; works under file://
vite.config.ts        single-bundle build config
```

## Build

```
pnpm install
pnpm build
```

Produces `dist/overlock.js` (~5.8 MB unminified, ~2 MB gzipped — ≈90 % of that
is the two inlined wasm blobs). The bundle is an IIFE — the page loads it as a
classic `<script src>`, not `<script type="module" src>`, because external
module scripts trip CORS under `file://`. The dynamic `import(blobUrl)` calls
the loader makes still work fine from a classic-script context.

After building, just open `index.html` in a browser — no static host required.

## Use

Anywhere on the page, after `await window.overlock.ready`:

```js
const mod = await automergeImport(automergeUrl, "./index.js");
console.log(mod.message);
```

Signature: `automergeImport(url, path = ".", options?) -> Promise<Module>`.

- `url` — an `automerge:...` URL pointing at a folder document. May or may not
  include `?heads=…`; if it doesn't, overlock pins to the current heads on
  first sight so the cache is stable.
- `path` — file inside the folder. Falls back to `package.json` `exports` (and
  then `main`) the same way patchwork's service worker does
  (`core/bootloader/src/service-worker.ts` lines 249–315).
- `options.pinHeads` — defaults to `true`; set `false` for live-reload
  experiments where you want each call to re-resolve the latest heads.

Inside loaded modules, three import shapes are understood:

| Specifier                     | Behavior                                           |
| ----------------------------- | -------------------------------------------------- |
| `./foo.js`, `../lib/bar.js`   | Resolved relative to the importer's path.          |
| `automerge:abc/some/path.js`  | Cross-doc reference; pinned to current heads.      |
| Bare (`react`, `automerge`, …) | Pass-through — left in the source unchanged. The browser will fail at import time unless you supply your own import map. |

ESM cycles aren't supported and throw a clear error on detection — blob URLs
can't be allocated before their content exists.

## Pushing the demo module

`modules/hello/` contains the smallest useful payload (`index.js` +
`greet.js`). Push it with [pushwork](../pushwork) onto the same Subduction
backend overlock connects to:

```
cd modules/hello
pushwork init . --sub
pushwork sync
pushwork url           # paste this into the input on index.html
```

Then open `index.html` in a browser, paste the URL, leave path as
`./index.js`, and click Load. Module exports show up below the form and on
`window._mod`.

## Sync configuration

By default overlock connects to `wss://subduction.sync.inkandswitch.com` (the
patchwork production endpoint). Override per page via query string or hash:

```
file:///.../overlock/index.html?subduction=wss://my-server.example
file:///.../overlock/index.html#subduction=wss://my-server.example
```

The hash variant exists because some browsers strip `?` from `file://` URLs.
You can pass the option multiple times to connect to several endpoints.

Identity is provided by `WebCryptoSigner.setup()` from
`@automerge/automerge-subduction/slim` — an Ed25519 keypair persisted in
IndexedDB so the peer ID is stable across page loads.

## Caveats

- **Bundle size.** The ~5.8 MB cost is mostly the two base64 wasm blobs
  (automerge ~3 MB, subduction ~1 MB before encoding overhead). If you need a
  smaller footprint, switch to `?url` imports + `assetsInlineLimit: Infinity`
  with a separate `.wasm` file — but that breaks `file://`.
- **No transpile.** Modules pulled out of automerge are loaded as-is. They
  need to be valid ES modules in whatever syntax the target browser supports.
  TypeScript / JSX / etc. would need to be pre-built before pushing.
- **Cycles unsupported.** See the rationale above.
- **Cross-Origin-Embedder-Policy headers.** Not needed for the loader itself,
  but if a hosted module wants to use SharedArrayBuffer-backed APIs, you're on
  your own — there's no SW to inject COEP headers like patchwork does.
