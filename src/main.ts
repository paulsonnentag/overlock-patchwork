// Bootstrap entry. Sets up an Automerge Repo synced over Subduction (matching
// pushwork --sub) and mounts a ViewRegistry on document.body.
//
// Lives in a single self-contained ES module; everything below is bundled into
// dist/patchwork.js by Vite. No service worker, no asset side-loads — wasm is
// inlined as base64 here so the page works under file://.

import * as Automerge from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import * as Subduction from "@automerge/automerge-subduction/slim";
// @ts-expect-error: "/wasm-base64" doesn't ship .d.ts
import { wasmBase64 as subductionWasmBase64 } from "@automerge/automerge-subduction/wasm-base64";
import * as AutomergeRepo from "@automerge/automerge-repo/slim";
import {
  Repo,
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";

import { Loader } from "./loader";
import { BranchableRepo } from "./branchable-repo";
import { PluginRegistry } from "./plugin-registry";
import { ViewRegistry } from "./view-registry";

import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

// Tag name for the bootstrap-time repo provider. Hyphenated so the
// view runtime's dash + `.value` walk picks it up; no class is
// registered, the only thing that matters is the hyphen and the
// `value` property installed below.
const REPO_CONTEXT_TAG = "patchwork-root";

window.AutomergeRepo = {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
};

const SUBDUCTION_ENDPOINT = "wss://subduction.sync.inkandswitch.com";

async function initPatchwork () {

  await Automerge.initializeBase64Wasm(automergeWasmBase64 as string);
  // @ts-expect-error: subduction's .d.ts doesn't expose the wasm-bindgen runtime helpers like `initSync`.
  Subduction.initSync({
    module: base64ToBytes(subductionWasmBase64 as string),
  });

  // Shared-instance dependencies for loaded packages. The Loader
  // generates ESM shim modules that re-read from this global so every
  // package gets the same wasm-initialised Automerge / Repo as the
  // host. See `Loader` in src/loader.ts and `__overlock` in
  // src/globals.d.ts.
  window.__overlock = {
    externals: {
      "@automerge/automerge": Automerge,
      "@automerge/automerge-repo": AutomergeRepo,
    },
  };

  const signer = await Subduction.WebCryptoSigner.setup();

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter("overlock"),
    signer,
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
    enableRemoteHeadsGossiping: true,
    subductionWebsocketEndpoints: [SUBDUCTION_ENDPOINT],
  });

  const branchableRepo = new BranchableRepo(repo);

  const packagesRoot = document
    .querySelector<HTMLMetaElement>('meta[name="overlock-packages-root"]')
    ?.content?.trim();
  const loader = new Loader({
    repo,
    externals: window.__overlock.externals,
    packagesRoot:
      packagesRoot && isValidAutomergeUrl(packagesRoot)
        ? (packagesRoot as AutomergeUrl)
        : undefined,
  });

  // Wrap whatever is already in <body> in a hyphenated custom-tag
  // wrapper whose `value` is the repo. Every view walks up looking
  // for the nearest custom-element ancestor exposing a `.value` that
  // is a `BranchableRepo`; this wrapper is the page-level fallback,
  // overridden by any closer context that publishes a different repo
  // (e.g. a `<checked-out-branch-context>`). The provider must be
  // installed before the registry starts scanning so the first mount
  // sees it. We install `value` directly rather than going through
  // `defineContext` from the helper package because (a) the bootstrap
  // can't await a package load before standing the registry up and
  // (b) the page-level repo never changes after install, so the
  // `source` setter / `change` event surface is unnecessary here.
  const ctx = document.createElement(REPO_CONTEXT_TAG);
  Object.defineProperty(ctx, "value", {
    value: branchableRepo,
    configurable: true,
  });
  while (document.body.firstChild) ctx.appendChild(document.body.firstChild);
  document.body.appendChild(ctx);

  const pluginRegistry = new PluginRegistry({
    repo: branchableRepo,
    import: (url) => loader.import(url),
  });

  new ViewRegistry({
    root: document.body,
    pluginRegistry,
  });
}

initPatchwork()

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
