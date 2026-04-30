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
import {
  PATCHWORK_CONTEXT_TAG,
  type PatchworkContext,
} from "./patchwork-context-element";

import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

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
    packagesRoot:
      packagesRoot && isValidAutomergeUrl(packagesRoot)
        ? (packagesRoot as AutomergeUrl)
        : undefined,
  });

  // Wrap whatever is already in <body> in a <patchwork-context> whose
  // value is the repo. Every view walks up to the nearest
  // <patchwork-context> with a `BranchableRepo` value to obtain
  // `el.repo`. The provider must be installed before the registry
  // starts scanning so the first mount sees it.
  const ctx = document.createElement(
    PATCHWORK_CONTEXT_TAG,
  ) as PatchworkContext;
  while (document.body.firstChild) ctx.appendChild(document.body.firstChild);
  document.body.appendChild(ctx);
  ctx.source = branchableRepo;

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
