import * as Automerge from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import * as Subduction from "@automerge/automerge-subduction/slim";
// @ts-expect-error: "/wasm-base64" doesn't ship .d.ts
import { wasmBase64 as subductionWasmBase64 } from "@automerge/automerge-subduction/wasm-base64";
import * as AutomergeRepo from "@automerge/automerge-repo/slim";
import {
  Repo,
  isValidAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";

import { Loader } from "./loader";
import { ModuleWatcher } from "./module-watcher";
import { ViewRegistry } from "./view-registry";

import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

const ROOT_MANIFEST_URL =
  "automerge:2Q6XWP6H1soyS1RFW7bzm6rabjnZ/dist/root.json";

const SUBDUCTION_ENDPOINT = "wss://subduction.sync.inkandswitch.com";

async function initPatchwork() {
  await Automerge.initializeBase64Wasm(automergeWasmBase64 as string);
  // @ts-expect-error: subduction's .d.ts doesn't expose the wasm-bindgen runtime helpers like `initSync`.
  Subduction.initSync({
    module: base64ToBytes(subductionWasmBase64 as string),
  });

  const externals = {
    "@automerge/automerge": Automerge,
    "@automerge/automerge-repo": AutomergeRepo,
  };

  const signer = await Subduction.WebCryptoSigner.setup();

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter("overlock"),
    signer,
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
    enableRemoteHeadsGossiping: true,
    subductionWebsocketEndpoints: [SUBDUCTION_ENDPOINT],
  });

  const packagesRoot = document
    .querySelector<HTMLMetaElement>('meta[name="overlock-packages-root"]')
    ?.content?.trim();
  const loader = new Loader({
    repo,
    externals,
    packagesRoot:
      packagesRoot && isValidAutomergeUrl(packagesRoot)
        ? (packagesRoot as AutomergeUrl)
        : undefined,
  });

  const moduleWatcher = new ModuleWatcher({
    repo,
    import: (url) => loader.import(url),
  });

  const viewRegistry = new ViewRegistry({
    root: document.body,
    moduleWatcher,
  });

  const repoEl = document.createElement("repo-provider");
  Object.assign(repoEl, { value: repo });
  repoEl.style.display = "contents";

  const registryEl = document.createElement("view-registry-provider");
  Object.assign(registryEl, { value: viewRegistry });
  registryEl.style.display = "contents";

  repoEl.appendChild(registryEl);

  const moduleWatcherEl = document.createElement("module-watcher-provider");
  Object.assign(moduleWatcherEl, { value: moduleWatcher });
  moduleWatcherEl.style.display = "contents";
  registryEl.appendChild(moduleWatcherEl);

  const rootName = await viewRegistry.registerView(ROOT_MANIFEST_URL);
  moduleWatcherEl.appendChild(document.createElement(rootName));

  document.body.appendChild(repoEl);
}

initPatchwork();

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
