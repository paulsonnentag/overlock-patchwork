import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import * as Subduction from "@automerge/automerge-subduction/slim";
import {
  Repo,
  initializeWasm as initializeAutomergeWasm,
} from "@automerge/vanillajs/slim";
import setupServiceWorker from "@inkandswitch/patchwork-bootloader";
import { bootstrap } from "patchwork-dom";

declare global {
  interface Window {
    repo: Repo;
  }

  interface HTMLElementTagNameMap {
    "patchwork-root": HTMLElement;
  }
}

async function main(): Promise<void> {
  const repo = await setupRepo();
  window.repo = repo;

  await whenDomReady;

  const root = document.querySelector("patchwork-root");
  if (!root) {
    throw new Error("[overlock-patchwork] missing <patchwork-root> element");
  }

  await bootstrap(root, repo);
}

async function setupRepo(): Promise<Repo> {
  const [automergeWasm, subductionWasm] = await Promise.all([
    fetch("/automerge.wasm").then((response) => response.arrayBuffer()),
    fetch("/subduction.wasm").then((response) => response.arrayBuffer()),
  ]);

  await initializeAutomergeWasm(new Uint8Array(automergeWasm));
  // @ts-expect-error initSync is provided by the wasm-bindgen runtime.
  Subduction.initSync(new Uint8Array(subductionWasm));

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter("overlock"),
    sharePolicy: async () => true,
    enableRemoteHeadsGossiping: true,
  });

  const serviceWorker = await setupServiceWorker();
  const networkAdapter = new MessageChannelNetworkAdapter(serviceWorker.port);
  repo.networkSubsystem.addNetworkAdapter(networkAdapter);
  await networkAdapter.whenReady();

  return repo;
}

main().catch((error) => {
  console.error("patchwork boot failed", error);
});

const whenDomReady =
  document.readyState === "loading"
    ? new Promise<void>((resolve) =>
        document.addEventListener("DOMContentLoaded", () => resolve(), {
          once: true,
        })
      )
    : Promise.resolve();
