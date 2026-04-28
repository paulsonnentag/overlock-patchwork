import EventEmitter from "eventemitter3";
import { type DocHandle } from "@automerge/automerge-repo/slim";
import {
  findHandleInFolderHandle,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

import { BranchableRepo } from "../branchable-repo";
import { parseAutomergeUrlWithPath, pinUrl, splitPath } from "../loader";

type Loader = (url: string) => Promise<unknown>;

/**
 * A loaded plugin: every field declared on the source manifest, with
 * `importUrl` resolved to an absolute URL, plus the imported JS
 * `module`.
 *
 * `PluginRegistry` only requires `name` and `importUrl`; everything
 * else (including `module`, which it sets itself) is carried through
 * opaquely so plugin kinds can layer their own required fields on
 * top via consumer-side narrowing. `module` is the raw return of
 * the injected `import` function; each plugin kind validates its own
 * shape.
 */
export type LoadedPlugin = {
  name: string;
  importUrl: string;
  module: unknown;
  [key: string]: unknown;
};

/**
 * Events emitted by `PluginRegistry`. Mirrors patchwork-next's
 * `PluginRegistryEvents` where the lifecycle aligns:
 *
 * - `loaded`   — first successful resolution of a plugin URL; the
 *                cached entry is now available.
 * - `updated`  — HMR re-fetch produced a new manifest or module.
 *                Carries `previous` and `next` snapshots so consumers
 *                can diff without keeping their own copy.
 * - `removed`  — `remove(pluginUrl)` evicted a cached entry.
 * - `changed`  — fires alongside every other event. Convenience for
 *                consumers (UI mirrors, dev tools) that only care
 *                that something moved.
 *
 * Patchwork-next's `registered` event has no analog — there's no
 * description-only state in our model. `load(pluginUrl)` does both
 * registration and loading in one step.
 */
export type PluginRegistryEvents = {
  loaded: (pluginUrl: string, plugin: LoadedPlugin) => void;
  updated: (
    pluginUrl: string,
    previous: LoadedPlugin,
    next: LoadedPlugin,
  ) => void;
  removed: (pluginUrl: string) => void;
  changed: () => void;
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

/**
 * Owns the plugin URL → `LoadedPlugin` load pipeline and the HMR
 * subscription that drives reloads. Extends `EventEmitter` from
 * `eventemitter3`; consumers subscribe via the standard
 * `on(event, fn)` / `off(event, fn)` pair.
 *
 * One folder subscription per unique plugin URL: the manifest's parent
 * folder document is watched, and any change there triggers a re-fetch
 * + a fan-out to every listener via `updated` (and `changed`). Pushwork
 * propagates child updates upward, so this catches edits to the
 * manifest, the JS module, or anything else inside the package's
 * folder.
 *
 * No dedup on event fires: the `updated` listener gets `previous` and
 * `next` on every successful re-fetch and decides whether anything
 * observable changed. That keeps the registry kind-agnostic — plugin
 * kinds with different "observable change" semantics can layer their
 * own dedup on top.
 */
export class PluginRegistry extends EventEmitter<PluginRegistryEvents> {
  readonly #repo: BranchableRepo;
  readonly #import: Loader;

  // Cached records, keyed by plugin URL. One entry per unique URL.
  readonly #loaded = new Map<string, PluginRecord>();
  readonly #loading = new Map<string, Promise<PluginRecord>>();

  #destroyed = false;

  constructor(options: PluginRegistryOptions) {
    super();
    this.#repo = options.repo;
    this.#import = options.import;
  }

  /**
   * Resolve `url` to its current `LoadedPlugin` snapshot. Idempotent;
   * concurrent calls share the in-flight promise; subsequent calls hit
   * the cache. The folder subscription that drives HMR is set up on
   * first load; subsequent calls do not re-subscribe.
   *
   * Fires `loaded` (and `changed`) on the first successful resolution
   * of a plugin URL. Cache hits do *not* re-fire `loaded`.
   */
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
        this.emit("loaded", url, record.plugin);
        this.emit("changed");
        return record;
      })
      .catch((err) => {
        this.#loading.delete(url);
        throw err;
      });
    this.#loading.set(url, promise);
    return promise.then((record) => record.plugin);
  }

  /**
   * Evict the cached entry for `url`. Drops the folder subscription,
   * fires `removed` and `changed`. No-op (returns false) if the URL
   * was not cached. In-flight loads for the URL are abandoned — when
   * they resolve they find no matching record and bail.
   */
  remove(url: string): boolean {
    const record = this.#loaded.get(url);
    if (!record) return false;
    record.unsubscribe();
    this.#loaded.delete(url);
    this.#loading.delete(url);
    this.emit("removed", url);
    this.emit("changed");
    return true;
  }

  /**
   * Drop every folder subscription, clear the cache, and remove all
   * listeners. After `destroy`, `load` rejects and registered
   * listeners never fire again.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const record of this.#loaded.values()) record.unsubscribe();
    this.#loaded.clear();
    this.#loading.clear();
    this.removeAllListeners();
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
            // findHandleInFolderHandle expects a raw `Repo`; module
            // resolution should never see branched docs.
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

    const onChange = (): void => {
      void this.#reload(url);
    };
    parentFolderHandle.on("change", onChange);
    const unsubscribe = (): void => {
      parentFolderHandle.off("change", onChange);
    };

    return { plugin, parentFolderHandle, unsubscribe };
  }

  /**
   * The manifest's parent folder doc changed. Re-fetch the plugin,
   * splice the new value into the cached record, and fire `updated`
   * (with `previous` and `next` snapshots) followed by `changed`.
   */
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

    this.emit("updated", url, previous, next);
    this.emit("changed");
  }

  /**
   * Fetch the manifest doc, parse it (only `name` and `importUrl` are
   * required; other fields are preserved opaquely), resolve `importUrl`
   * against the manifest's URL to an absolute automerge URL, pin the
   * absolute URL to current heads so the loader's blob cache produces
   * a fresh module on HMR, and fetch the module.
   */
  async #fetchPlugin(
    url: string,
    parentFolderHandle: DocHandle<FolderDoc>,
    manifestName: string,
  ): Promise<LoadedPlugin> {
    const manifestHandle = await findHandleInFolderHandle<UnixFileEntry>(
      // findHandleInFolderHandle expects a raw `Repo`; module resolution
      // should never see branched docs.
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

/**
 * Resolve a manifest's `importUrl` (currently restricted to a `./`
 * sibling reference) against the manifest's own URL. Only `./` is
 * supported for now — `../` and bare specifiers are rejected so HMR's
 * pinning semantics stay obvious.
 *
 * Returned URL is absolute but *not* heads-pinned. Pinning happens
 * separately at import time so the resolved `importUrl` stays stable
 * across HMR reloads.
 */
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
