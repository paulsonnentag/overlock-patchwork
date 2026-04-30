# Loader

`new Loader({ repo, packagesRoot? })` exposes `loader.import(url)`,
which resolves an `automerge:` URL into an executable ES module: walk
the folder doc, rewrite imports, dynamic `import()` of a blob URL. The
in-page equivalent of patchwork's service-worker loader, so the bundle
works under `file://`.

Source: [`src/loader.ts`](../src/loader.ts). Wasm bootstrap inlined at
the top of [`src/main.ts`](../src/main.ts).

## Entry point

`loader.import(url) -> Promise<Module>`. Used by `PluginRegistry` via
the `import` option; not exposed on `window`.

URL shape: `automerge:<docId>[?heads=...][/<path>]`. When `path` is
absent, `resolveFileHandle` falls back to `package.json` `exports`
then `main`, mirroring patchwork's service worker.

`loader.setPackagesRoot(url)` registers the friendly-DevTools-name
folder; the constructor also accepts a `packagesRoot` option that
calls it for you.

Pure URL helpers re-exported alongside the class:
`parseAutomergeUrlWithPath`, `pinUrl`, `splitPath`.

## Specifier rewriting

After fetching, the source is parsed with `es-module-lexer` and every
`import` / `import(...)` / `export ... from` is rewritten:

| Specifier | Behavior |
| --- | --- |
| `./foo.js`, `../lib/bar.js` | Resolved relative to importer's path inside the folder doc. |
| `automerge:abc/some/path.js` | Cross-doc; pinned to current heads on first sight. |
| `/foo.js` | Resolved against importer's root folder. |
| Registered external (e.g. `@automerge/automerge`) | Rewritten to a blob URL whose source re-reads from `window.__overlock.externals[key]` so every package shares the host's live module instance. See [Externals](#externals). |
| Bare (`react`, `solid-js`, …) | Pass-through. |
| `https://esm.sh/...` | Pass-through. |

Rewriting splices end → start so lexer offsets stay valid.

## Externals

Pass `externals: Record<string, object>` to the `Loader` constructor
to share live module instances between the host bundle and every
loaded package. For each entry the loader synthesises a tiny ESM
shim:

```js
const m = window.__overlock.externals["@automerge/automerge-repo"];
export const parseAutomergeUrl = m.parseAutomergeUrl;
// …one line per Object.keys(mod) entry…
export default m;
```

The shim is wrapped in a `Blob`, the resulting URL is cached, and
`#resolveSpecifier` returns it whenever a loaded package imports the
key. Every package gets the same blob URL → the same module instance
→ the same wasm-initialised state. The host populates
`window.__overlock.externals` in `main.ts` before constructing the
loader.

Caveat: `export const x = m.x` captures the value at shim-evaluation
time, so swapping the underlying module reference post-init won't
propagate. Fine for the current `Automerge` / `AutomergeRepo`
namespaces, which don't change after wasm init.

## Heads pinning + caching

URLs without heads get pinned to current heads via `pinUrl`. Pinning
itself is uncached (queries `handle.heads()` afresh) so HMR sees new
heads, but the resulting blob URL is cached on the `Loader` instance
keyed by `(rootUrl-with-heads, path)`. One instance per page is the
expected deployment, mirroring the single `Repo` set up in `main.ts`.

## Cycles

Detected via an `inFlight` set per top-level call and rejected with a
clear error. Blob URLs can't be allocated before their content exists,
so cycles would deadlock the rewriter.

## DevTools naming

Rewritten modules get a `//# sourceURL=...` pragma. See the private
`#friendlyRootFor` in `src/loader.ts`. Two shapes:

- **`packages/<name>/<file>`** when the script's root is a child of
  the registered packages folder (`<meta name="overlock-packages-root">`
  → `loader.setPackagesRoot`).
- **`automerge:<documentId>/<file>`** otherwise. Heads dropped on
  purpose so breakpoints survive HMR.

## Wasm bootstrap

`main.ts` initializes `@automerge/automerge` and
`@automerge/automerge-subduction` from base64-inlined wasm. ~5.8 MB
unminified bundle, ~90 % wasm. See `main.ts` for the `initSync` /
`initializeBase64Wasm` calls.

## Sync

Hard-coded `wss://subduction.sync.inkandswitch.com` in `main.ts` —
edit and rebuild to override. Identity from
`Subduction.WebCryptoSigner.setup()`, persisted in IndexedDB.

## Caveats

- No transpile — modules must be valid ES in the target browser.
- Cycles unsupported.
- No SW means no COEP injection for SharedArrayBuffer-backed APIs.
