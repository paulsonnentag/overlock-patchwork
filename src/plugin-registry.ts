import { type DocHandle } from "@automerge/automerge-repo/slim";
import {
  findHandleInFolderHandle,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

import { BranchableRepo } from "./branchable-repo";
import { parseAutomergeUrlWithPath, pinUrl, splitPath } from "./loader";

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
 * Event detail payloads. The registry extends `EventTarget` and
 * dispatches `CustomEvent`s; consumers pull args off `event.detail`:
 *
 *   reg.addEventListener("updated", e => {
 *     const { pluginUrl, previous, next } = e.detail;
 *   });
 *
 * - `loaded`   — first successful resolution of a plugin URL.
 * - `updated`  — HMR re-fetch produced a new manifest or module.
 *                Carries `previous` and `next` snapshots so consumers
 *                can diff without keeping their own copy.
 * - `removed`  — `remove(pluginUrl)` evicted a cached entry.
 * - `changed`  — fires alongside every other event. Convenience for
 *                consumers (UI mirrors, dev tools) that only care
 *                that something moved. Empty detail.
 *
 * `addEventListener` accepts `{ signal }` for batch unsubscription;
 * one `AbortController.abort()` tears down every listener registered
 * with that signal.
 */
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

/**
 * Owns the plugin URL → `LoadedPlugin` load pipeline and the HMR
 * subscription that drives reloads. Extends `EventTarget`; consumers
 * subscribe via the standard `addEventListener(name, fn)` /
 * `removeEventListener(name, fn)` pair.
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
export class PluginRegistry extends EventTarget {
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
    this.#emit("removed", { pluginUrl: url });
    this.#emit("changed", undefined);
    return true;
  }

  /**
   * Drop every folder subscription and clear the cache. After
   * `destroy`, `load` rejects. Existing `addEventListener` registrations
   * are *not* removed automatically — consumers should pair
   * registrations with an `AbortSignal` if they need batch cleanup.
   */
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

    // The folder doc handle is an automerge-repo `DocHandle` (still
    // EventEmitter-shaped upstream), so subscribe via `.on/.off`
    // rather than `addEventListener`.
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

    this.#emit("updated", { pluginUrl: url, previous, next });
    this.#emit("changed", undefined);
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
