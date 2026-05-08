import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import * as Subduction from "@automerge/automerge-subduction/slim";
import {
  Repo,
  initializeWasm as initializeAutomergeWasm,
} from "@automerge/vanillajs/slim";
import setupServiceWorker from "@inkandswitch/patchwork-bootloader";

import { ComponentRegistry } from "./component-registry";

declare global {
  interface Window {
    repo: Repo;
  }

  interface HTMLElementTagNameMap {
    "repo-provider": HTMLElement & { value: Repo };
    "view-registry-provider": HTMLElement & { value: ComponentRegistry };
    "patchwork-root": HTMLElement;
  }
}

async function main(): Promise<void> {
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

  window.repo = repo;

  const repoProvider = document.querySelector("repo-provider");
  if (!repoProvider) {
    throw new Error("[overlock-patchwork] missing <repo-provider> element");
  }
  repoProvider.value = repo;

  const registryProvider = document.querySelector("view-registry-provider");
  if (!registryProvider) {
    throw new Error(
      "[overlock-patchwork] missing <view-registry-provider> element"
    );
  }
  const registry = new ComponentRegistry({ root: registryProvider });
  registryProvider.value = registry;

  const root = document.querySelector("patchwork-root");
  if (!root) {
    throw new Error("[overlock-patchwork] missing <patchwork-root> element");
  }

  const src = root.getAttribute("src");
  if (!src) throw new Error("<patchwork-root> is missing src");

  const mod = await import(encodeURIComponent(src));
  if (typeof mod.default !== "function") {
    throw new Error(
      `[overlock-patchwork] root module "${src}" has no default-export mount fn`
    );
  }

  await mod.default(root);
}

main().catch((error) => {
  console.error("patchwork boot failed", error);
});
