import setupServiceWorker from "@inkandswitch/patchwork-bootloader";
import * as Subduction from "@automerge/automerge-subduction/slim";
import {
  Repo,
  initializeWasm as initializeAutomergeWasm,
} from "@automerge/vanillajs/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";

async function main(): Promise<void> {
  await initializeWasm();

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter("overlock"),
    sharePolicy: async () => true,
    enableRemoteHeadsGossiping: true,
  });

  const sw = await setupServiceWorker();
  const net = new MessageChannelNetworkAdapter(sw.port);
  repo.networkSubsystem.addNetworkAdapter(net);
  await net.whenReady();
}

async function initializeWasm(): Promise<void> {
  const [automergeWasm, subductionWasm] = await Promise.all([
    fetch("/automerge.wasm").then((response) => response.arrayBuffer()),
    fetch("/subduction.wasm").then((response) => response.arrayBuffer()),
  ]);

  await initializeAutomergeWasm(new Uint8Array(automergeWasm));
  // @ts-expect-error initSync is provided by the wasm-bindgen runtime.
  Subduction.initSync(new Uint8Array(subductionWasm));
}

main().catch((error) => {
  console.error("patchwork boot failed", error);
});
