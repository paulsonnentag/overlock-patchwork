import { type DocHandle } from "@automerge/automerge-repo/slim";
import {
  findHandleInFolderHandle,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

import { BranchableRepo } from "./branchable-repo";
import { parseAutomergeUrlWithPath, pinUrl, splitPath } from "./loader";

type Loader = (url: string) => Promise<unknown>;

export type LoadedPlugin = {
  name: string;
  importUrl: string;
  module: unknown;
  [key: string]: unknown;
};

export type PluginRegistryEventMap = {
  loaded: CustomEvent<{ pluginUrl: string; plugin: LoadedPlugin }>;
  updated: CustomEvent<{
    pluginUrl: string;
    previous: LoadedPlugin;
    next: LoadedPlugin;
  }>;
  removed: CustomEvent<{ pluginUrl: string }>;
  changed: Event;
};

export type PluginRegistryOptions = {
  repo: BranchableRepo;
  import: Loader;
};

type PluginRecord = {
  plugin: LoadedPlugin;
  parentFolderHandle: DocHandle<FolderDoc>;
  unsubscribe: () => void;
};

// pluginUrl → LoadedPlugin cache + folder subscription for HMR. One
// folder subscription per unique URL drives `updated` fan-out; consumer
// kinds (the view registry) layer their own dedup on top.
export class PluginRegistry extends EventTarget {
  readonly #repo: BranchableRepo;
  readonly #import: Loader;
  readonly #loaded = new Map<string, PluginRecord>();
  readonly #loading = new Map<string, Promise<PluginRecord>>();
  #destroyed = false;

  constructor(options: PluginRegistryOptions) {
    super();
    this.#repo = options.repo;
    this.#import = options.import;
  }

  async load(url: string): Promise<LoadedPlugin> {
    if (this.#destroyed) {
      throw new Error("[overlock-patchwork] PluginRegistry has been destroyed");
    }
    const cached = this.#loaded.get(url);
    if (cached) return cached.plugin;
    const inFlight = this.#loading.get(url);
    if (inFlight) return inFlight.then((record) => record.plugin);
    const promise = this.#loadFresh(url)
      .then((record) => {
        this.#loaded.set(url, record);
        this.#loading.delete(url);
        this.#emit("loaded", { pluginUrl: url, plugin: record.plugin });
        this.#emit("changed", undefined);
        return record;
      })
      .catch((err) => {
        this.#loading.delete(url);
        throw err;
      });
    this.#loading.set(url, promise);
    return promise.then((record) => record.plugin);
  }

  remove(url: string): boolean {
    const record = this.#loaded.get(url);
    if (!record) return false;
    record.unsubscribe();
    this.#loaded.delete(url);
    this.#loading.delete(url);
    this.#emit("removed", { pluginUrl: url });
    this.#emit("changed", undefined);
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const record of this.#loaded.values()) record.unsubscribe();
    this.#loaded.clear();
    this.#loading.clear();
  }

  #emit<K extends keyof PluginRegistryEventMap>(
    name: K,
    detail: PluginRegistryEventMap[K] extends CustomEvent<infer D> ? D : undefined,
  ): void {
    if (detail === undefined) {
      this.dispatchEvent(new Event(name));
    } else {
      this.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  async #loadFresh(url: string): Promise<PluginRecord> {
    const { rootUrl, path } = parseAutomergeUrlWithPath(url);
    const parts = splitPath(path);
    if (parts.length === 0) {
      throw new Error(
        `[overlock-patchwork] manifest URL must reference a file: ${url}`,
      );
    }

    const rootHandle = await this.#repo.find<FolderDoc>(rootUrl);
    const parentParts = parts.slice(0, -1);
    const manifestName = parts[parts.length - 1];
    const parentFolderHandle =
      parentParts.length === 0
        ? rootHandle
        : ((await findHandleInFolderHandle<FolderDoc>(
            // Module resolution should never see branched docs.
            this.#repo.repo,
            rootHandle,
            parentParts,
          )) as DocHandle<FolderDoc> | undefined);
    if (!parentFolderHandle) {
      throw new Error(
        `[overlock-patchwork] could not resolve parent folder for ${url}`,
      );
    }

    const plugin = await this.#fetchPlugin(url, parentFolderHandle, manifestName);

    // automerge-repo `DocHandle` is still EventEmitter-shaped upstream;
    // use `.on/.off` rather than `addEventListener`.
    const onChange = (): void => {
      void this.#reload(url);
    };
    parentFolderHandle.on("change", onChange);
    const unsubscribe = (): void => {
      parentFolderHandle.off("change", onChange);
    };

    return { plugin, parentFolderHandle, unsubscribe };
  }

  async #reload(url: string): Promise<void> {
    if (this.#destroyed) return;
    const old = this.#loaded.get(url);
    if (!old) return;

    const { path } = parseAutomergeUrlWithPath(url);
    const parts = splitPath(path);
    const manifestName = parts[parts.length - 1];

    let next: LoadedPlugin;
    try {
      next = await this.#fetchPlugin(url, old.parentFolderHandle, manifestName);
    } catch (err) {
      console.error(
        `[overlock-patchwork] HMR reload failed for ${url}:`,
        err,
      );
      return;
    }

    if (this.#destroyed) return;
    if (this.#loaded.get(url) !== old) return;

    const previous = old.plugin;
    old.plugin = next;

    this.#emit("updated", { pluginUrl: url, previous, next });
    this.#emit("changed", undefined);
  }

  // manifest doc → parse → resolve `importUrl` → pin to current heads
  // (so the loader's blob cache produces a fresh module on HMR) →
  // import.
  async #fetchPlugin(
    url: string,
    parentFolderHandle: DocHandle<FolderDoc>,
    manifestName: string,
  ): Promise<LoadedPlugin> {
    const manifestHandle = await findHandleInFolderHandle<UnixFileEntry>(
      this.#repo.repo,
      parentFolderHandle,
      [manifestName],
    );
    if (!manifestHandle) {
      throw new Error(`[overlock-patchwork] manifest not found: ${url}`);
    }
    const manifest = readManifest(
      manifestHandle as DocHandle<UnixFileEntry>,
      url,
    );

    const absoluteImportUrl = resolveImportUrl(url, manifest.importUrl);
    const pinnedImportUrl = await pinUrl(this.#repo.repo, absoluteImportUrl);
    const module = await this.#import(pinnedImportUrl);

    return {
      ...manifest,
      importUrl: absoluteImportUrl,
      module,
    };
  }
}

type RawManifest = {
  name: string;
  importUrl: string;
  [key: string]: unknown;
};

function readManifest(
  handle: DocHandle<UnixFileEntry>,
  pluginUrl: string,
): RawManifest {
  const doc = handle.doc();
  const content = doc?.content;
  if (content == null) {
    throw new Error(`[overlock-patchwork] manifest has no content: ${pluginUrl}`);
  }
  const text =
    typeof content === "string"
      ? content
      : new TextDecoder().decode(content as Uint8Array);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `[overlock-patchwork] invalid JSON in manifest ${pluginUrl}: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { importUrl?: unknown }).importUrl !== "string"
  ) {
    throw new Error(
      `[overlock-patchwork] manifest missing "name" or "importUrl": ${pluginUrl}`,
    );
  }
  return parsed as RawManifest;
}

// Returns absolute but not heads-pinned. Pinning happens at import time
// so the resolved `importUrl` stays stable across HMR reloads. Only `./`
// is supported for now.
function resolveImportUrl(manifestUrl: string, importUrl: string): string {
  if (!importUrl.startsWith("./")) {
    throw new Error(
      `[overlock-patchwork] manifest "importUrl" must start with "./" (got "${importUrl}")`,
    );
  }
  const lastSlash = manifestUrl.lastIndexOf("/");
  if (lastSlash === -1 || lastSlash <= "automerge:".length) {
    throw new Error(
      `[overlock-patchwork] cannot resolve "${importUrl}" against root URL`,
    );
  }
  const dir = manifestUrl.slice(0, lastSlash);
  return `${dir}/${importUrl.slice(2)}`;
}
