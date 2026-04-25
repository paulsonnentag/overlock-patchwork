// Bootstrap entry. Sets up an Automerge Repo synced over Subduction (matching
// pushwork --sub) and exposes window.automergeImport(automergeUrl, path).
//
// Lives in a single self-contained ES module; everything below is bundled into
// dist/overlock.js by Vite. No service worker, no asset side-loads — wasm is
// inlined as base64 in wasm-loader.ts so the page works under file://.

import {
  Repo,
  type AutomergeUrl,
  type PeerId,
} from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { WebCryptoSigner } from "@automerge/automerge-subduction/slim";

import { ensureWasm } from "./wasm-loader";
import { automergeImport, type ImportOptions } from "./automerge-import";

const DEFAULT_SUBDUCTION_ENDPOINTS = [
  "wss://subduction.sync.inkandswitch.com",
];

declare global {
  interface Window {
    overlock: {
      repo: Repo;
      ready: Promise<void>;
    };
    automergeImport: (
      url: AutomergeUrl,
      path?: string,
      options?: ImportOptions,
    ) => Promise<unknown>;
  }
}

const ready = (async () => {
  await ensureWasm();

  const subductionEndpoints =
    readEndpointsFromLocation() ?? DEFAULT_SUBDUCTION_ENDPOINTS;

  const signer = await WebCryptoSigner.setup();

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter("overlock"),
    signer,
    peerId: ("overlock-" +
      Math.random().toString(36).slice(2, 10)) as PeerId,
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
    enableRemoteHeadsGossiping: true,
    subductionWebsocketEndpoints: subductionEndpoints,
  });

  window.overlock = {
    repo,
    ready: Promise.resolve(),
  };

  window.automergeImport = (url, path = ".", options) =>
    automergeImport(repo, url, path, options ?? {});
})().catch((error) => {
  console.error("overlock: bootstrap failed", error);
  throw error;
});

window.overlock = {
  // Replaced once boot completes; kept here so callers can `await window.overlock.ready`.
  repo: undefined as unknown as Repo,
  ready,
};

window.automergeImport = async (url, path = ".", options) => {
  await ready;
  return automergeImport(window.overlock.repo, url, path, options ?? {});
};

function readEndpointsFromLocation(): string[] | null {
  // Allow ?subduction=wss://… overrides for hosted deployments. Hash params
  // and query both work so file:// URLs (which strip query strings in some
  // browsers) can still configure via #subduction=…
  const sources: URLSearchParams[] = [];
  if (location.search) sources.push(new URLSearchParams(location.search));
  if (location.hash.startsWith("#"))
    sources.push(new URLSearchParams(location.hash.slice(1)));
  for (const params of sources) {
    const list = params.getAll("subduction");
    if (list.length) return list;
  }
  return null;
}
