import {
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  findHandleInFolderHandle,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

import { parseAutomergeUrlWithPath, pinUrl, splitPath } from "./loader";
import { TypedEventTarget } from "./typed-event-target";

type Loader = (url: string) => Promise<unknown>;

export type LoadedComponent = {
  name: string;
  module: string;
  exports: unknown;
};

export type ModuleLoadedEvent = CustomEvent<{
  moduleUrl: string;
  module: LoadedComponent;
}>;

export type ModuleUpdatedEvent = CustomEvent<{
  moduleUrl: string;
  previous: LoadedComponent;
  next: LoadedComponent;
}>;

export type ModuleRemovedEvent = CustomEvent<{
  moduleUrl: string;
  name: string;
}>;

export type ModuleEvent =
  | ModuleLoadedEvent
  | ModuleUpdatedEvent
  | ModuleRemovedEvent;

export type ModuleWatcherEventMap = {
  loaded: ModuleLoadedEvent;
  updated: ModuleUpdatedEvent;
  removed: ModuleRemovedEvent;
};

export type ModuleWatcherOptions = {
  repo: Repo;
  import: Loader;
};

type ComponentEntry = { name: string; module: string };

type ParsedComponentUrl = {
  rootUrl: AutomergeUrl;
  packageJsonPath: string;
  packageJsonUrl: string;
  kind: string;
  name: string;
};

type ModuleRecord = {
  module: LoadedComponent;
  packageJsonHandle: DocHandle<UnixFileEntry>;
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

  async load(url: string): Promise<LoadedComponent> {
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
    const parsed = parseComponentUrl(url);
    const packageJsonHandle = await this.#findPackageJson(parsed);
    const entry = readContribution(packageJsonHandle, parsed);
    const module = await this.#fetchAndImport(parsed.packageJsonUrl, entry);

    const onChange = (): void => {
      void this.#reload(url);
    };
    packageJsonHandle.on("change", onChange);
    const unsubscribe = (): void => {
      packageJsonHandle.off("change", onChange);
    };

    return { module, packageJsonHandle, unsubscribe };
  }

  async #reload(url: string): Promise<void> {
    if (this.#destroyed) return;
    const old = this.#loaded.get(url);
    if (!old) return;

    const parsed = parseComponentUrl(url);
    let next: LoadedComponent;
    try {
      const entry = readContribution(old.packageJsonHandle, parsed);
      next = await this.#fetchAndImport(parsed.packageJsonUrl, entry);
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
      new CustomEvent("updated", {
        detail: { moduleUrl: url, previous, next },
      }),
    );
  }

  async #findPackageJson(
    parsed: ParsedComponentUrl,
  ): Promise<DocHandle<UnixFileEntry>> {
    const parts = splitPath(parsed.packageJsonPath);
    if (parts.length === 0) {
      throw new Error(
        `[overlock-patchwork] component URL must reference a package.json file: ${parsed.packageJsonUrl}`,
      );
    }
    const rootHandle = await this.#repo.find<FolderDoc>(parsed.rootUrl);
    const handle = await findHandleInFolderHandle<UnixFileEntry>(
      this.#repo,
      rootHandle,
      parts,
    );
    if (!handle) {
      throw new Error(
        `[overlock-patchwork] could not find ${parsed.packageJsonPath} in ${parsed.rootUrl}`,
      );
    }
    return handle as DocHandle<UnixFileEntry>;
  }

  async #fetchAndImport(
    packageJsonUrl: string,
    entry: ComponentEntry,
  ): Promise<LoadedComponent> {
    const absoluteImportUrl = resolveImportUrl(packageJsonUrl, entry.module);
    const pinnedImportUrl = await pinUrl(this.#repo, absoluteImportUrl);
    const exports = await this.#import(pinnedImportUrl);
    return {
      name: entry.name,
      module: absoluteImportUrl,
      exports,
    };
  }
}

export function isModuleWatcher(value: unknown): value is ModuleWatcher {
  return value instanceof ModuleWatcher;
}

// Component URL = `<automerge-url-with-optional-heads>/<path/to/package.json>#<kind>/<name>`.
// Heads also use `#` (`automerge:<docId>#<head1|head2>`) so split via the
// path returned by `parseAutomergeUrlWithPath` rather than naive `#`-search.
function parseComponentUrl(url: string): ParsedComponentUrl {
  const { rootUrl, path } = parseAutomergeUrlWithPath(url);
  const hashIdx = path.lastIndexOf("#");
  if (hashIdx === -1) {
    throw new Error(
      `[overlock-patchwork] component URL must include a "#<kind>/<name>" fragment: ${url}`,
    );
  }
  const packageJsonPath = path.slice(0, hashIdx);
  const fragment = path.slice(hashIdx + 1);
  const slash = fragment.indexOf("/");
  if (slash <= 0 || slash >= fragment.length - 1) {
    throw new Error(
      `[overlock-patchwork] component URL fragment must be "<kind>/<name>": ${url}`,
    );
  }
  const packageJsonUrl = packageJsonPath
    ? `${rootUrl}/${packageJsonPath}`
    : (rootUrl as string);
  return {
    rootUrl,
    packageJsonPath,
    packageJsonUrl,
    kind: fragment.slice(0, slash),
    name: fragment.slice(slash + 1),
  };
}

function readContribution(
  packageJsonHandle: DocHandle<UnixFileEntry>,
  parsed: ParsedComponentUrl,
): ComponentEntry {
  const doc = packageJsonHandle.doc();
  const content = doc?.content;
  if (content == null) {
    throw new Error(
      `[overlock-patchwork] package.json has no content: ${parsed.packageJsonUrl}`,
    );
  }
  let pkgJson: unknown;
  try {
    pkgJson = JSON.parse(contentToText(content));
  } catch (err) {
    throw new Error(
      `[overlock-patchwork] invalid JSON in package.json for ${parsed.packageJsonUrl}: ${(err as Error).message}`,
    );
  }
  const contributions = (pkgJson as { contributions?: Record<string, unknown> })
    ?.contributions;
  const entries = contributions?.[parsed.kind];
  if (!Array.isArray(entries)) {
    throw new Error(
      `[overlock-patchwork] no contributions.${parsed.kind} array in ${parsed.packageJsonUrl}`,
    );
  }
  const entry = entries.find(
    (e): e is ComponentEntry =>
      e != null &&
      typeof e === "object" &&
      typeof (e as { name?: unknown }).name === "string" &&
      typeof (e as { module?: unknown }).module === "string" &&
      (e as { name: string }).name === parsed.name,
  );
  if (!entry) {
    throw new Error(
      `[overlock-patchwork] no contributions.${parsed.kind} entry named "${parsed.name}" in ${parsed.packageJsonUrl}`,
    );
  }
  if (!entry.module.startsWith("./") && !entry.module.startsWith("../")) {
    throw new Error(
      `[overlock-patchwork] contribution "${parsed.name}" module must start with "./" or "../" (got "${entry.module}")`,
    );
  }
  return { name: entry.name, module: entry.module };
}

function contentToText(content: UnixFileEntry["content"]): string {
  if (typeof content === "string") return content;
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(content);
  if (ArrayBuffer.isView(content)) return new TextDecoder().decode(content);
  if (Array.isArray(content))
    return new TextDecoder().decode(Uint8Array.from(content));
  return String(content);
}

// `automerge:` isn't a hierarchical scheme the URL parser understands, so
// borrow `http:` to do the path math, then swap the scheme back.
function resolveImportUrl(packageJsonUrl: string, importUrl: string): string {
  if (!packageJsonUrl.startsWith("automerge:")) {
    throw new Error(
      `[overlock-patchwork] expected automerge: URL, got "${packageJsonUrl}"`,
    );
  }
  const FAKE = "http://overlock.invalid/";
  const base = `${FAKE}${packageJsonUrl.slice("automerge:".length)}`;
  const resolved = new URL(importUrl, base).href;
  if (!resolved.startsWith(FAKE)) {
    throw new Error(
      `[overlock-patchwork] resolved URL escaped package root: "${importUrl}" from ${packageJsonUrl}`,
    );
  }
  return `automerge:${resolved.slice(FAKE.length)}`;
}
