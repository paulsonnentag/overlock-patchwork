import { type DocHandle, type Repo } from "@automerge/automerge-repo/slim";
import {
  findHandleInFolderHandle,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

import { parseAutomergeUrlWithPath, pinUrl, splitPath } from "./loader";
import { TypedEventTarget } from "./typed-event-target";

type Loader = (url: string) => Promise<unknown>;

export type LoadedModule = {
  name: string;
  importUrl: string;
  module: unknown;
  [key: string]: unknown;
};

export type ModuleLoadedEvent = CustomEvent<{ moduleUrl: string; module: LoadedModule }>;

export type ModuleUpdatedEvent = CustomEvent<{
  moduleUrl: string;
  previous: LoadedModule;
  next: LoadedModule;
}>;

export type ModuleRemovedEvent = CustomEvent<{ moduleUrl: string; name: string }>;

export type ModuleEvent =
  | ModuleLoadedEvent
  | ModuleUpdatedEvent
  | ModuleRemovedEvent

export type ModuleWatcherEventMap = {
  loaded: ModuleLoadedEvent;
  updated: ModuleUpdatedEvent;
  removed: ModuleRemovedEvent;
};

export type ModuleWatcherOptions = {
  repo: Repo;
  import: Loader;
};

type ModuleRecord = {
  module: LoadedModule;
  parentFolderHandle: DocHandle<FolderDoc>;
  unsubscribe: () => void;
};

export class ModuleWatcher extends TypedEventTarget<ModuleWatcherEventMap> {
  readonly #repo: Repo;
  readonly #import: Loader;
  readonly #loaded = new Map<string, ModuleRecord>();
  readonly #loading = new Map<string, Promise<ModuleRecord>>();
  #destroyed = false;

  constructor(options: ModuleWatcherOptions) {
    super();
    this.#repo = options.repo;
    this.#import = options.import;
  }

  async load(url: string): Promise<LoadedModule> {
    if (this.#destroyed) {
      throw new Error("[overlock-patchwork] ModuleWatcher has been destroyed");
    }
    const cached = this.#loaded.get(url);
    if (cached) return cached.module;
    const inFlight = this.#loading.get(url);
    if (inFlight) return inFlight.then((record) => record.module);
    const promise = this.#loadFresh(url)
      .then((record) => {
        this.#loaded.set(url, record);
        this.#loading.delete(url);
        this.dispatchEvent(
          new CustomEvent("loaded", {
            detail: { moduleUrl: url, module: record.module },
          }),
        );
        return record;
      })
      .catch((err) => {
        this.#loading.delete(url);
        throw err;
      });
    this.#loading.set(url, promise);
    return promise.then((record) => record.module);
  }

  remove(url: string): boolean {
    const record = this.#loaded.get(url);
    if (!record) return false;
    record.unsubscribe();
    this.#loaded.delete(url);
    this.#loading.delete(url);
    this.dispatchEvent(
      new CustomEvent("removed", {
        detail: { moduleUrl: url, name: record.module.name },
      }),
    );
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const record of this.#loaded.values()) record.unsubscribe();
    this.#loaded.clear();
    this.#loading.clear();
  }

  async #loadFresh(url: string): Promise<ModuleRecord> {
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
            this.#repo,
            rootHandle,
            parentParts,
          )) as DocHandle<FolderDoc> | undefined);
    if (!parentFolderHandle) {
      throw new Error(
        `[overlock-patchwork] could not resolve parent folder for ${url}`,
      );
    }

    const module = await this.#fetchModule(url, parentFolderHandle, manifestName);

    const onChange = (): void => {
      void this.#reload(url);
    };
    parentFolderHandle.on("change", onChange);
    const unsubscribe = (): void => {
      parentFolderHandle.off("change", onChange);
    };

    return { module, parentFolderHandle, unsubscribe };
  }

  async #reload(url: string): Promise<void> {
    if (this.#destroyed) return;
    const old = this.#loaded.get(url);
    if (!old) return;

    const { path } = parseAutomergeUrlWithPath(url);
    const parts = splitPath(path);
    const manifestName = parts[parts.length - 1];

    let next: LoadedModule;
    try {
      next = await this.#fetchModule(url, old.parentFolderHandle, manifestName);
    } catch (err) {
      console.error(
        `[overlock-patchwork] HMR reload failed for ${url}:`,
        err,
      );
      return;
    }

    if (this.#destroyed) return;
    if (this.#loaded.get(url) !== old) return;

    const previous = old.module;
    old.module = next;

    this.dispatchEvent(
      new CustomEvent("updated", { detail: { moduleUrl: url, previous, next } }),
    );
  }

  async #fetchModule(
    url: string,
    parentFolderHandle: DocHandle<FolderDoc>,
    manifestName: string,
  ): Promise<LoadedModule> {
    const manifestHandle = await findHandleInFolderHandle<UnixFileEntry>(
      this.#repo,
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
    const pinnedImportUrl = await pinUrl(this.#repo, absoluteImportUrl);
    const module = await this.#import(pinnedImportUrl);

    return {
      ...manifest,
      importUrl: absoluteImportUrl,
      module,
    };
  }
}

export function isModuleWatcher(value: unknown): value is ModuleWatcher {
  return value instanceof ModuleWatcher;
}

type RawManifest = {
  name: string;
  importUrl: string;
  [key: string]: unknown;
};

function readManifest(
  handle: DocHandle<UnixFileEntry>,
  moduleUrl: string,
): RawManifest {
  const doc = handle.doc();
  const content = doc?.content;
  if (content == null) {
    throw new Error(`[overlock-patchwork] manifest has no content: ${moduleUrl}`);
  }
  const text = contentToText(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `[overlock-patchwork] invalid JSON in manifest ${moduleUrl}: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { importUrl?: unknown }).importUrl !== "string"
  ) {
    throw new Error(
      `[overlock-patchwork] manifest missing "name" or "importUrl": ${moduleUrl}`,
    );
  }
  return parsed as RawManifest;
}

function contentToText(content: UnixFileEntry["content"]): string {
  if (typeof content === "string") return content;
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(content);
  if (ArrayBuffer.isView(content)) return new TextDecoder().decode(content);
  if (Array.isArray(content)) return new TextDecoder().decode(Uint8Array.from(content));
  return String(content);
}

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
