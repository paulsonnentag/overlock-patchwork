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
import { ModuleWatcher, type LoadedModule } from "./module-watcher";
import { ViewRegistry, type MountFn } from "./view-registry";

import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

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

  const branchableRepo = new BranchableRepo(repo);

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

  // Page-level repo provider. `value` is installed directly rather
  // than via `defineContext` because the bootstrap can't await a
  // package load before standing the registry up, and the page-level
  // repo never changes after install.
  const ctx = document.createElement(REPO_CONTEXT_TAG);
  Object.defineProperty(ctx, "value", {
    value: branchableRepo,
    configurable: true,
  });
  while (document.body.firstChild) ctx.appendChild(document.body.firstChild);
  document.body.appendChild(ctx);

  const moduleWatcher = new ModuleWatcher({
    repo: branchableRepo,
    import: (url) => loader.import(url),
  });

  const viewRegistry = new ViewRegistry(document.body);

  moduleWatcher.addEventListener("loaded", (event) => {
    registerModuleView(viewRegistry, event.detail.module);
  });
  moduleWatcher.addEventListener("updated", (event) => {
    registerModuleView(viewRegistry, event.detail.next);
  });

  window.patchwork = {
    async registerView(manifestUrl: string): Promise<void> {
      await moduleWatcher.load(manifestUrl);
    },
  };
}

function registerModuleView(
  viewRegistry: ViewRegistry,
  module: LoadedModule,
): void {
  const mount = (module.module as { default?: unknown })?.default;
  if (typeof mount !== "function") {
    console.warn(
      `[overlock-patchwork] module "${module.name}" has no default export, skipping view registration`,
    );
    return;
  }
  viewRegistry.registerView(module.name, mount as MountFn);
}

initPatchwork()

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
