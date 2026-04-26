// Bootstrap entry. Sets up an Automerge Repo synced over Subduction (matching
// pushwork --sub) and exposes window.automergeImport(spec).
//
// Lives in a single self-contained ES module; everything below is bundled into
// dist/overlock.js by Vite. No service worker, no asset side-loads — wasm is
// inlined as base64 in wasm-loader.ts so the page works under file://.

import { Repo, type PeerId } from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { WebCryptoSigner } from "@automerge/automerge-subduction/slim";

import { ensureWasm } from "./wasm-loader";
import { automergeImport } from "./automerge-import";

const SUBDUCTION_ENDPOINT = "wss://subduction.sync.inkandswitch.com";

const isPatchworkReady = (async () => {
  await ensureWasm();

  const signer = await WebCryptoSigner.setup();

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter("overlock"),
    signer,
    peerId: ("overlock-" +
      Math.random().toString(36).slice(2, 10)) as PeerId,
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
    enableRemoteHeadsGossiping: true,
    subductionWebsocketEndpoints: [SUBDUCTION_ENDPOINT],
  });

  window.repo = repo;
})().catch((error) => {
  console.error("overlock: bootstrap failed", error);
  throw error;
});

window.isPatchworkReady = isPatchworkReady;

window.automergeImport = async (spec) => {
  await isPatchworkReady;
  return automergeImport(window.repo, spec);
};
