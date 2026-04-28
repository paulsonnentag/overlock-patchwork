# Loader

`importFromAutomerge(repo, url)` is the bottom layer of
overlock-patchwork. It resolves an `automerge:` URL into an executable
ES module by walking the folder document in the in-page `Repo`,
rewriting every import in the source to a sibling blob URL, and
dynamically importing the rewritten module.

This is the in-page equivalent of patchwork's service-worker loader
(`patchwork-next/core/bootloader/src/service-worker.ts`): instead of
intercepting `fetch` and returning real HTTP responses, the loader
stays inside the page so the bundle works under `file://`.

Implementation lives in
[`src/loader.ts`](../src/loader.ts), with the wasm bootstrap inlined at
the top of [`src/main.ts`](../src/main.ts).

## API

`importFromAutomerge(repo, url) -> Promise<Module>` is the loader entry
point used by `PluginRegistry` (via the `import` option) to resolve and
execute view modules. It is not exposed on `window`.

A `url` is `automerge:<documentId>[?heads=...][/<path>]`. The loader
splits at the first `/` after the `automerge:` prefix:

- `automerge:abc...` → root URL, path `""`
- `automerge:abc.../greet.js` → root URL, path `greet.js`

`path` falls back to `package.json` `exports` (and then `main`) the
same way patchwork's service worker does
(`core/bootloader/src/service-worker.ts` lines 249–315). The fallback
is implemented in `resolveFileHandle` in
[`src/loader.ts`](../src/loader.ts).

The loader also exports a few small URL helpers reused by
`PluginRegistry`:

- `parseAutomergeUrlWithPath(url) -> { rootUrl, path }` — split a URL
  with optional path into its document URL and path component.
- `pinUrl(repo, url) -> Promise<string>` — pin the URL's root to the
  document's current heads (no-op if already pinned). Uncached, so
  callers (notably `PluginRegistry`'s HMR path) see fresh heads on
  every call.
- `splitPath(p) -> string[]` — split a slash-delimited path into
  segments, dropping empties and the leading `./`.

## Specifier rewriting

After fetching the source, the loader parses it with `es-module-lexer`
and rewrites every static `import`, dynamic `import("...")`, and
`export ... from` specifier:

| Specifier | Behavior |
| --- | --- |
| `./foo.js`, `../lib/bar.js` | Resolved relative to the importer's path inside the same folder doc. |
| `automerge:abc/some/path.js` | Cross-doc reference; pinned to current heads on first sight. |
| `/foo.js` | Resolved against the importer's root folder. |
| Bare (`react`, `solid-js`, …) | Pass-through — left untouched. The browser will fail at import time unless the host page provides an import map. |
| `https://esm.sh/...` | Pass-through, same as bare specifiers. The browser fetches them directly. |

Rewriting splices end → start so byte offsets returned by the lexer
stay valid.

## Heads pinning

If the URL's root carries no heads, the loader pins it to the
document's current heads (`pinUrl` in
[`src/loader.ts`](../src/loader.ts)). Pinning is uncached: each call
queries `handle.heads()` afresh. The resulting blob URL is cached in
`blobUrlCache` keyed by `(rootUrl, path)`, where `rootUrl` already
carries heads.

That keeps the cache stable across calls with the same effective heads
— two `importFromAutomerge` calls return the same blob URL — and lets
`PluginRegistry`'s HMR path produce a *fresh* module by re-pinning to
the new heads (see [`lifecycle.md`](./lifecycle.md)).

`blobUrlCache` is module-scoped and not keyed by `Repo`. The bootstrap
in [`src/main.ts`](../src/main.ts) creates exactly one `Repo` per
page, so this is fine. If multiple isolated `Repo`s ever share a page,
the cache should be keyed by `Repo` via a `WeakMap`.

## Cycles

ESM cycles aren't supported and throw a clear error on detection. Blob
URLs can't be allocated before their content exists, so a cycle would
deadlock the rewriter. The loader tracks an `inFlight` set per top-level
`importFromAutomerge` call and throws on re-entry:

```
overlock: import cycle detected at automerge:.../foo.js. Cycles are
not supported because blob URLs cannot be allocated before their
content exists.
```

## DevTools naming

Rewritten JS modules get a `//# sourceURL=…` pragma appended before
they're turned into a blob. DevTools picks that up and shows the
script under a friendly path in the Sources panel and in stack traces,
instead of `blob:http://…/<uuid>`.

There are two name shapes (`friendlyRootFor` in
[`src/loader.ts`](../src/loader.ts)):

- **Packages.** If the script's root document is a direct child of the
  registered packages folder, the URL is
  `packages/<child-name>/<file>` — e.g. `packages/url-sync/url-sync.js`.
  The child name comes from the parent folder's `DocLink.name`, so
  `pnpm push packages` controls it.
- **Fallback.** Anything else gets `automerge:<documentId>/<file>` —
  the unpinned root URL plus the file path. Heads are intentionally
  dropped so every version of the doc shares one DevTools entry and
  breakpoints persist across HMR reloads.

The packages folder is opt-in. Add a meta tag to the host page:

```html
<meta name="overlock-packages-root" content="automerge:…">
```

`main.ts` reads it once at boot and passes the URL to `setPackagesRoot`
in [`src/loader.ts`](../src/loader.ts), which fetches the folder doc
and builds an in-memory `documentId → name` index. The index is loaded
once — adding a new package after page load won't show up under
`packages/` until the next reload. The URL itself comes from
`packages/.pushwork/snapshot.json`'s `rootFolderUrl`, which pushwork
preserves across pushes.

## Wasm bootstrap

The first step of the bootstrap IIFE in
[`src/main.ts`](../src/main.ts) initializes the slim entry points of
`@automerge/automerge` and `@automerge/automerge-subduction` from
base64-inlined wasm blobs. That's why `dist/overlock.js` is ~5.8 MB
unminified — ~3 MB automerge wasm, ~1 MB subduction wasm, plus base64
overhead.

The base64 path mirrors the SW init in
`patchwork-next/core/bootloader/src/service-worker.ts` lines 116–122
but runs in the page so no separate `.wasm` fetch is needed and the
bundle works under `file://`.

## Sync configuration

The bootstrap in [`src/main.ts`](../src/main.ts) connects to a single
hard-coded Subduction endpoint:

```ts
const SUBDUCTION_ENDPOINT = "wss://subduction.sync.inkandswitch.com";
```

Override by editing the constant and rebuilding (`pnpm build`). There
is no per-page query-string or hash override yet.

Identity is provided by `WebCryptoSigner.setup()` from
`@automerge/automerge-subduction/slim` — an Ed25519 keypair persisted
in IndexedDB so the peer ID is stable across page loads.

## Caveats

- **Bundle size.** ~5.8 MB unminified (~2 MB gzipped), ~90 % of which
  is the two inlined wasm blobs. If you need a smaller footprint,
  switch to `?url` imports + `assetsInlineLimit: Infinity` with a
  separate `.wasm` file — but that breaks `file://`.
- **No transpile.** Modules pulled out of automerge are loaded as-is.
  They need to be valid ES modules in whatever syntax the target
  browser supports. TypeScript / JSX / etc. would need to be pre-built
  before pushing.
- **Cycles unsupported.** See above.
- **Cross-Origin-Embedder-Policy.** Not needed for the loader itself,
  but if a hosted module wants to use SharedArrayBuffer-backed APIs,
  you're on your own — there's no SW to inject COEP headers like
  patchwork does.
