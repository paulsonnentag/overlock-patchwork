import EventEmitter from "eventemitter3";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";
import {
  findHandleInFolderHandle,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

import { BranchableRepo } from "../branchable-repo";

type AutomergeImport = (spec: string) => Promise<unknown>;

/**
 * A loaded plugin: every field declared on the source manifest, with
 * `importUrl` resolved to an absolute spec, plus the imported JS
 * `module`.
 *
 * `PluginRegistry` only requires `name` and `importUrl`; everything
 * else (including `module`, which it sets itself) is carried through
 * opaquely so plugin kinds can layer their own required fields on
 * top via consumer-side narrowing. `module` is the raw return of
 * `automergeImport(...)`; each plugin kind validates its own shape.
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
 * - `loaded`   — first successful resolution of a spec; the cached
 *                entry is now available.
 * - `updated`  — HMR re-fetch produced a new manifest or module.
 *                Carries `previous` and `next` snapshots so consumers
 *                can diff without keeping their own copy.
 * - `removed`  — `remove(spec)` evicted a cached entry.
 * - `changed`  — fires alongside every other event. Convenience for
 *                consumers (UI mirrors, dev tools) that only care
 *                that something moved.
 *
 * Patchwork-next's `registered` event has no analog — there's no
 * description-only state in our model. `load(spec)` does both
 * registration and loading in one step.
 */
export type PluginRegistryEvents = {
  loaded: (spec: string, plugin: LoadedPlugin) => void;
  updated: (
    spec: string,
    previous: LoadedPlugin,
    next: LoadedPlugin,
  ) => void;
  removed: (spec: string) => void;
  changed: () => void;
};

type Deps = {
  repo: BranchableRepo;
  automergeImport: AutomergeImport;
};

type PluginRecord = {
  plugin: LoadedPlugin;
  parentFolderHandle: DocHandle<FolderDoc>;
  unsubscribe: () => void;
};

/**
 * Owns the plugin spec → `LoadedPlugin` load pipeline and the HMR
 * subscription that drives reloads. Extends `EventEmitter` from
 * `eventemitter3`; consumers subscribe via `on(event, fn)` (overridden
 * to return an unsubscribe handle, matching patchwork-next).
 *
 * One folder subscription per unique spec: the manifest's parent folder
 * document is watched, and any change there triggers a re-fetch + a
 * fan-out to every listener via `updated` (and `changed`). Pushwork
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
  readonly #automergeImport: AutomergeImport;

  // Cached records, keyed by spec. One entry per unique spec.
  readonly #loaded = new Map<string, PluginRecord>();
  readonly #loading = new Map<string, Promise<PluginRecord>>();

  #destroyed = false;

  constructor(deps: Deps) {
    super();
    this.#repo = deps.repo;
    this.#automergeImport = deps.automergeImport;
  }

  /**
   * Resolve `spec` to its current `LoadedPlugin` snapshot. Idempotent;
   * concurrent calls share the in-flight promise; subsequent calls hit
   * the cache. The folder subscription that drives HMR is set up on
   * first load; subsequent calls do not re-subscribe.
   *
   * Fires `loaded` (and `changed`) on the first successful resolution
   * of a spec. Cache hits do *not* re-fire `loaded`.
   */
  async load(spec: string): Promise<LoadedPlugin> {
    if (this.#destroyed) {
      throw new Error("[overlock-patchwork] PluginRegistry has been destroyed");
    }
    const cached = this.#loaded.get(spec);
    if (cached) return cached.plugin;
    const inFlight = this.#loading.get(spec);
    if (inFlight) return inFlight.then((record) => record.plugin);
    const promise = this.#loadFresh(spec)
      .then((record) => {
        this.#loaded.set(spec, record);
        this.#loading.delete(spec);
        this.emit("loaded", spec, record.plugin);
        this.emit("changed");
        return record;
      })
      .catch((err) => {
        this.#loading.delete(spec);
        throw err;
      });
    this.#loading.set(spec, promise);
    return promise.then((record) => record.plugin);
  }

  /**
   * Evict the cached entry for `spec`. Drops the folder subscription,
   * fires `removed` and `changed`. No-op (returns false) if the spec
   * was not cached. In-flight loads for the spec are abandoned — when
   * they resolve they find no matching record and bail.
   */
  remove(spec: string): boolean {
    const record = this.#loaded.get(spec);
    if (!record) return false;
    record.unsubscribe();
    this.#loaded.delete(spec);
    this.#loading.delete(spec);
    this.emit("removed", spec);
    this.emit("changed");
    return true;
  }

  /**
   * Subscribe to a registry event. Returns an unsubscribe function.
   * Overrides the inherited `EventEmitter.on` (which returns `this`).
   * Matches the contract patchwork-next exposes on its registry.
   */
  // @ts-expect-error: deliberate override — the inherited `on` returns
  // `this`, we return the unsubscribe handle. Matches patchwork-next's
  // `registry.on(...)` API.
  on<E extends keyof PluginRegistryEvents>(
    event: E,
    listener: PluginRegistryEvents[E],
  ): () => void {
    super.on(event, listener as never);
    return () => {
      super.off(event, listener as never);
    };
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

  async #loadFresh(spec: string): Promise<PluginRecord> {
    const { rootUrl, path } = parseSpec(spec);
    const parts = splitPath(path);
    if (parts.length === 0) {
      throw new Error(
        `[overlock-patchwork] manifest spec must reference a file: ${spec}`,
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
        `[overlock-patchwork] could not resolve parent folder for ${spec}`,
      );
    }

    const plugin = await this.#fetchPlugin(spec, parentFolderHandle, manifestName);

    const onChange = (): void => {
      void this.#hmrReload(spec);
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
  async #hmrReload(spec: string): Promise<void> {
    if (this.#destroyed) return;
    const old = this.#loaded.get(spec);
    if (!old) return;

    const { path } = parseSpec(spec);
    const parts = splitPath(path);
    const manifestName = parts[parts.length - 1];

    let next: LoadedPlugin;
    try {
      next = await this.#fetchPlugin(spec, old.parentFolderHandle, manifestName);
    } catch (err) {
      console.error(
        `[overlock-patchwork] HMR reload failed for ${spec}:`,
        err,
      );
      return;
    }

    if (this.#destroyed) return;
    if (this.#loaded.get(spec) !== old) return;

    const previous = old.plugin;
    old.plugin = next;

    this.emit("updated", spec, previous, next);
    this.emit("changed");
  }

  /**
   * Fetch the manifest doc, parse it (only `name` and `importUrl` are
   * required; other fields are preserved opaquely), resolve `importUrl`
   * against the manifest's spec to an absolute automerge URL, pin the
   * absolute URL to current heads for `automergeImport`'s blob cache,
   * and fetch the module.
   */
  async #fetchPlugin(
    spec: string,
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
      throw new Error(`[overlock-patchwork] manifest not found: ${spec}`);
    }
    const manifest = readManifest(
      manifestHandle as DocHandle<UnixFileEntry>,
      spec,
    );

    const absoluteImportUrl = resolveImportUrl(spec, manifest.importUrl);
    const pinnedImportUrl = await pinSpec(this.#repo, absoluteImportUrl);
    const module = await this.#automergeImport(pinnedImportUrl);

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
  spec: string,
): RawManifest {
  const doc = handle.doc();
  const content = doc?.content;
  if (content == null) {
    throw new Error(`[overlock-patchwork] manifest has no content: ${spec}`);
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
      `[overlock-patchwork] invalid JSON in manifest ${spec}: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { importUrl?: unknown }).importUrl !== "string"
  ) {
    throw new Error(
      `[overlock-patchwork] manifest missing "name" or "importUrl": ${spec}`,
    );
  }
  return parsed as RawManifest;
}

function parseSpec(spec: string): { rootUrl: AutomergeUrl; path: string } {
  if (!spec.startsWith("automerge:")) {
    throw new Error(
      `[overlock-patchwork] expected an automerge: spec, got "${spec}"`,
    );
  }
  const slash = spec.indexOf("/", "automerge:".length);
  const urlPart = (slash === -1 ? spec : spec.slice(0, slash)) as AutomergeUrl;
  const path = slash === -1 ? "" : spec.slice(slash + 1);
  if (!isValidAutomergeUrl(urlPart)) {
    throw new Error(
      `[overlock-patchwork] not a valid automerge URL: "${urlPart}"`,
    );
  }
  return { rootUrl: urlPart, path };
}

function splitPath(p: string): string[] {
  return p
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean);
}

/**
 * Resolve a manifest's `importUrl` (currently restricted to a `./`
 * sibling reference) against the manifest's own spec. Only `./` is
 * supported for now — `../` and bare specifiers are rejected so HMR's
 * pinning semantics stay obvious.
 *
 * Returned URL is absolute but *not* heads-pinned. Pinning happens
 * separately at import time so the resolved `importUrl` stays stable
 * across HMR reloads.
 */
function resolveImportUrl(manifestSpec: string, importUrl: string): string {
  if (!importUrl.startsWith("./")) {
    throw new Error(
      `[overlock-patchwork] manifest "importUrl" must start with "./" (got "${importUrl}")`,
    );
  }
  const lastSlash = manifestSpec.lastIndexOf("/");
  if (lastSlash === -1 || lastSlash <= "automerge:".length) {
    throw new Error(
      `[overlock-patchwork] cannot resolve "${importUrl}" against root spec`,
    );
  }
  const dir = manifestSpec.slice(0, lastSlash);
  return `${dir}/${importUrl.slice(2)}`;
}

/**
 * Pre-pin the spec's root url to current heads so `automergeImport`'s blob
 * cache doesn't serve stale content across HMR reloads. Each pinned URL is
 * unique per heads, so each HMR fetch produces a fresh module.
 */
async function pinSpec(repo: BranchableRepo, spec: string): Promise<string> {
  const { rootUrl, path } = parseSpec(spec);
  const { documentId, heads } = parseAutomergeUrl(rootUrl);
  if (heads && heads.length) return spec;
  const handle = await repo.find(rootUrl);
  const pinned = stringifyAutomergeUrl({ documentId, heads: handle.heads() });
  return path ? `${pinned}/${path}` : pinned;
}
