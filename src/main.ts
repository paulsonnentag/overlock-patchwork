// Bootstrap entry. Sets up an Automerge Repo synced over Subduction (matching
// pushwork --sub) and exposes window.automergeImport(spec).
//
// Lives in a single self-contained ES module; everything below is bundled into
// dist/overlock.js by Vite. No service worker, no asset side-loads — wasm is
// inlined as base64 here so the page works under file://.

import * as Automerge from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import * as Subduction from "@automerge/automerge-subduction/slim";
// @ts-expect-error: "/wasm-base64" doesn't ship .d.ts
import { wasmBase64 as subductionWasmBase64 } from "@automerge/automerge-subduction/wasm-base64";
import { Repo } from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";

import { automergeImport } from "./automerge-import";
import { BranchableRepo } from "./branchable-repo";
import { ComponentRegistry } from "./components";

const SUBDUCTION_ENDPOINT = "wss://subduction.sync.inkandswitch.com";

const isPatchworkReady = (async () => {
  // Mirrors the SW init in
  // patchwork-next/core/bootloader/src/service-worker.ts (lines 116-122),
  // but uses the base64 variant and runs in the page so the bundle works
  // under file:// without a separate .wasm fetch.
  await Automerge.initializeBase64Wasm(automergeWasmBase64 as string);
  // wasm-bindgen's new initSync signature is `({ module })`; passing the
  // bytes positionally still works but warns. Wrap in an object.
  // @ts-expect-error: subduction's .d.ts doesn't expose the wasm-bindgen
  // runtime helpers like `initSync`.
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

  // Expose the forkable wrapper as `window.repo`. While unbranched it
  // delegates straight to the underlying `Repo`, so existing component
  // code (`repo.find`, `repo.create`, …) keeps working unchanged.
  window.repo = BranchableRepo.wrap(repo);
})().catch((error) => {
  console.error("overlock: bootstrap failed", error);
  throw error;
});

window.isPatchworkReady = isPatchworkReady;

window.automergeImport = async (spec) => {
  await isPatchworkReady;
  // Module resolution is system-level and must never see branched docs,
  // so it runs against the underlying raw `Repo`.
  return automergeImport(window.repo.repo, spec);
};

// `<patchwork-view>`-driven component registry. Page scripts call this
// once, after `isPatchworkReady`, to attach the observer to a root element
// (typically `document.body`). The factory closes over the bootstrapped
// repo + automergeImport so the page only has to pick a root.
window.createComponentRegistry = (root) =>
  new ComponentRegistry(root, {
    repo: window.repo,
    automergeImport: window.automergeImport,
  });

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
