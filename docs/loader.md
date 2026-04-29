# Loader

`importFromAutomerge(repo, url)` resolves an `automerge:` URL into an
executable ES module: walk the folder doc, rewrite imports, dynamic
`import()` of a blob URL. The in-page equivalent of patchwork's
service-worker loader, so the bundle works under `file://`.

Source: [`src/loader.ts`](../src/loader.ts). Wasm bootstrap inlined at
the top of [`src/main.ts`](../src/main.ts).

## Entry point

`importFromAutomerge(repo, url) -> Promise<Module>`. Used by
`PluginRegistry` via the `import` option; not exposed on `window`.

URL shape: `automerge:<docId>[?heads=...][/<path>]`. When `path` is
absent, `resolveFileHandle` falls back to `package.json` `exports`
then `main`, mirroring patchwork's service worker.

Helpers also exported: `parseAutomergeUrlWithPath`, `pinUrl`,
`splitPath`, `setPackagesRoot`.

## Specifier rewriting

After fetching, the source is parsed with `es-module-lexer` and every
`import` / `import(...)` / `export ... from` is rewritten:

| Specifier | Behavior |
| --- | --- |
| `./foo.js`, `../lib/bar.js` | Resolved relative to importer's path inside the folder doc. |
| `automerge:abc/some/path.js` | Cross-doc; pinned to current heads on first sight. |
| `/foo.js` | Resolved against importer's root folder. |
| Bare (`react`, `solid-js`, …) | Pass-through. |
| `https://esm.sh/...` | Pass-through. |

Rewriting splices end → start so lexer offsets stay valid.

## Heads pinning + caching

URLs without heads get pinned to current heads via `pinUrl`. Pinning
itself is uncached (queries `handle.heads()` afresh) so HMR sees new
heads, but the resulting blob URL is cached in `blobUrlCache` keyed by
`(rootUrl-with-heads, path)`. Cache is module-scoped — fine because
`main.ts` creates one `Repo` per page.

## Cycles

Detected via an `inFlight` set per top-level call and rejected with a
clear error. Blob URLs can't be allocated before their content exists,
so cycles would deadlock the rewriter.

## DevTools naming

Rewritten modules get a `//# sourceURL=...` pragma. See
`friendlyRootFor` in `src/loader.ts`. Two shapes:

- **`packages/<name>/<file>`** when the script's root is a child of
  the registered packages folder (`<meta name="overlock-packages-root">`
  → `setPackagesRoot`).
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
