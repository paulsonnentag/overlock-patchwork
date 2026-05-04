import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  defaultImportConditions,
  findHandleInFolderHandle,
  resolvePackageExport,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";
import * as Lexer from "es-module-lexer";

type CacheKey = string;

// Shared with generated shim modules via the global symbol registry —
// each shim does `window[Symbol.for(EXTERNALS_SYMBOL_KEY)]` to recover
// this map. Plain `Symbol(...)` won't work because shims run in their
// own ESM scope.
const EXTERNALS_SYMBOL_KEY = "overlock.loader.externals";
const EXTERNALS_SYMBOL = Symbol.for(EXTERNALS_SYMBOL_KEY);

export type LoaderOptions = {
  repo: Repo;
  packagesRoot?: AutomergeUrl;
  externals?: Record<string, object>;
};

export class Loader {
  readonly #repo: Repo;
  readonly #blobUrlCache = new Map<CacheKey, Promise<string>>();
  readonly #externalUrls = new Map<string, string>();
  // documentId → friendly DevTools sourceURL name; `null` before the
  // folder doc resolves.
  #packagesIndex: Map<string, string> | null = null;

  constructor(opts: LoaderOptions) {
    this.#repo = opts.repo;
    if (opts.externals) {
      installExternals(opts.externals);
      for (const [key, mod] of Object.entries(opts.externals)) {
        const source = buildExternalShimSource(key, mod);
        const blob = new Blob([source], { type: "text/javascript" });
        this.#externalUrls.set(key, URL.createObjectURL(blob));
      }
    }
    if (opts.packagesRoot) this.setPackagesRoot(opts.packagesRoot);
  }

  async import(url: string): Promise<unknown> {
    await Lexer.init;
    const pinned = await pinUrl(this.#repo, url);
    const { rootUrl, path } = parseAutomergeUrlWithPath(pinned);
    const blobUrl = await this.#materialize(rootUrl, normalizePath(path));
    return import(/* @vite-ignore */ blobUrl);
  }

  setPackagesRoot(url: AutomergeUrl): void {
    void this.#loadPackagesIndex(url);
  }

  async #loadPackagesIndex(url: AutomergeUrl): Promise<void> {
    try {
      const handle = await this.#repo.find<FolderDoc>(url);
      const index = new Map<string, string>();
      for (const link of handle.doc()?.docs ?? []) {
        const { documentId } = parseAutomergeUrl(link.url);
        index.set(documentId, link.name);
      }
      this.#packagesIndex = index;
    } catch (error) {
      console.warn(`overlock: failed to load packages root ${url}`, error);
    }
  }

  async #materialize(
    rootUrl: AutomergeUrl,
    path: string,
    inFlight: Set<CacheKey> = new Set(),
  ): Promise<string> {
    const key = `${rootUrl}|${path}`;
    const cached = this.#blobUrlCache.get(key);
    if (cached) return cached;

    if (inFlight.has(key)) {
      throw new Error(
        `overlock: import cycle detected at ${rootUrl}/${path}. ` +
          `Cycles are not supported because blob URLs cannot be allocated ` +
          `before their content exists.`,
      );
    }
    inFlight.add(key);

    const promise = (async () => {
      const folderHandle = await this.#repo.find<FolderDoc>(rootUrl);
      const fileHandle = await resolveFileHandle(this.#repo, folderHandle, path);
      if (!fileHandle) {
        throw new Error(`overlock: could not resolve "${path}" in ${rootUrl}`);
      }

      // Re-derive the canonical path after exports resolution: asking
      // for "." may have landed on "dist/index.js"; relative imports
      // inside should resolve against "dist/", not the requested subpath.
      const canonicalPath = canonicalPathOf(folderHandle, fileHandle, path);

      const fileDoc = fileHandle.doc() as UnixFileEntry;
      const content = fileDoc?.content;
      if (content == null) {
        throw new Error(`overlock: file ${rootUrl}/${path} has no content`);
      }

      const mimeType =
        fileDoc.mimeType ?? guessMimeType(canonicalPath ?? path);

      if (!isJavaScript(mimeType, canonicalPath ?? path)) {
        const blob = new Blob([toBlobPart(content)], { type: mimeType });
        return URL.createObjectURL(blob);
      }

      const source =
        typeof content === "string"
          ? content
          : new TextDecoder().decode(toUint8Array(content));

      const rewritten = await this.#rewriteImports(
        rootUrl,
        canonicalPath ?? path,
        source,
        inFlight,
      );

      // `//# sourceURL=…` so DevTools shows a meaningful path.
      const filePath = canonicalPath || path || "index.js";
      const sourceUrl = `${this.#friendlyRootFor(rootUrl)}/${filePath}`;
      const annotated = `${rewritten}\n//# sourceURL=${sourceUrl}\n`;
      const blob = new Blob([annotated], { type: "text/javascript" });
      return URL.createObjectURL(blob);
    })().finally(() => {
      inFlight.delete(key);
    });

    this.#blobUrlCache.set(key, promise);
    return promise;
  }

  async #rewriteImports(
    rootUrl: AutomergeUrl,
    fromPath: string,
    source: string,
    inFlight: Set<CacheKey>,
  ): Promise<string> {
    const [imports] = Lexer.parse(source);

    // Resolve in parallel, splice end → start so offsets stay valid.
    const resolved = await Promise.all(
      imports.map(async (imp) => {
        const spec = imp.n;
        if (!spec) return null;
        try {
          const replacement = await this.#resolveSpecifier(
            rootUrl,
            fromPath,
            spec,
            inFlight,
          );
          if (replacement == null) return null;
          return { start: imp.s, end: imp.e, replacement };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `overlock: failed to resolve "${spec}" from ${rootUrl}/${fromPath}: ${detail}`,
          );
        }
      }),
    );

    let out = source;
    for (let i = resolved.length - 1; i >= 0; i--) {
      const r = resolved[i];
      if (!r) continue;
      out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
    }
    return out;
  }

  async #resolveSpecifier(
    rootUrl: AutomergeUrl,
    fromPath: string,
    spec: string,
    inFlight: Set<CacheKey>,
  ): Promise<string | null> {
    if (spec.startsWith("automerge:")) {
      const pinned = await pinUrl(this.#repo, spec);
      const { rootUrl: pinnedRoot, path } = parseAutomergeUrlWithPath(pinned);
      return this.#materialize(pinnedRoot, normalizePath(path), inFlight);
    }

    if (spec.startsWith("./") || spec.startsWith("../")) {
      const resolvedPath = resolveRelative(fromPath, spec);
      return this.#materialize(rootUrl, resolvedPath, inFlight);
    }

    if (spec.startsWith("/")) {
      return this.#materialize(rootUrl, normalizePath(spec), inFlight);
    }

    const externalUrl = this.#externalUrls.get(spec);
    if (externalUrl) return externalUrl;

    // Passthrough — the browser will try an importmap or throw at
    // import time.
    return null;
  }

  #friendlyRootFor(rootUrl: AutomergeUrl): string {
    const { documentId } = parseAutomergeUrl(rootUrl);
    const pkgName = this.#packagesIndex?.get(documentId);
    if (pkgName) return `packages/${pkgName}`;
    // Drop heads so breakpoints survive HMR.
    return stringifyAutomergeUrl({ documentId });
  }
}

export function parseAutomergeUrlWithPath(
  url: string,
): { rootUrl: AutomergeUrl; path: string } {
  if (!url.startsWith("automerge:")) {
    throw new Error(`overlock: expected an automerge: URL, got "${url}"`);
  }
  const slash = url.indexOf("/", "automerge:".length);
  const urlPart = (slash === -1 ? url : url.slice(0, slash)) as AutomergeUrl;
  const path = slash === -1 ? "" : url.slice(slash + 1);
  if (!isValidAutomergeUrl(urlPart)) {
    throw new Error(`overlock: not a valid automerge URL: "${urlPart}"`);
  }
  return { rootUrl: urlPart, path };
}

// Uncached on purpose: HMR relies on fresh `handle.heads()` to
// invalidate the loader's blob cache.
export async function pinUrl(repo: Repo, url: string): Promise<string> {
  const { rootUrl, path } = parseAutomergeUrlWithPath(url);
  const { documentId, heads } = parseAutomergeUrl(rootUrl);
  if (heads && heads.length) return url;
  const handle = await repo.find(rootUrl);
  const pinnedRoot = stringifyAutomergeUrl({
    documentId,
    heads: handle.heads(),
  });
  return path ? `${pinnedRoot}/${path}` : pinnedRoot;
}

export function splitPath(p: string): string[] {
  return p
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean);
}

function installExternals(externals: Record<string, object>): void {
  const w = window as unknown as Record<symbol, Record<string, object>>;
  const bag = w[EXTERNALS_SYMBOL] ?? {};
  Object.assign(bag, externals);
  w[EXTERNALS_SYMBOL] = bag;
}

function buildExternalShimSource(key: string, mod: object): string {
  const lines = [
    `const m = window[Symbol.for(${JSON.stringify(EXTERNALS_SYMBOL_KEY)})][${JSON.stringify(key)}];`,
  ];
  for (const k of Object.keys(mod)) {
    if (k === "default") continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)) continue;
    lines.push(`export const ${k} = m.${k};`);
  }
  lines.push(`export default m;`);
  lines.push(`//# sourceURL=overlock-external/${key}`);
  return lines.join("\n");
}

function normalizePath(p: string): string {
  return p
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function resolveRelative(fromFile: string, spec: string): string {
  // Hierarchical base so `URL` resolves against `fromFile`'s directory.
  const base = "fake:///" + fromFile;
  const u = new URL(spec, base);
  return normalizePath(u.pathname);
}

function canonicalPathOf(
  folderHandle: DocHandle<FolderDoc>,
  _fileHandle: DocHandle<UnixFileEntry>,
  requestedPath: string,
): string | null {
  if (requestedPath && !requestedPath.endsWith("/")) return requestedPath;
  // Exports resolution kicked in: best-effort, pick the first JS/JSON link.
  const folder = folderHandle.doc();
  if (!folder?.docs?.length) return null;
  const link = folder.docs.find((d) => /\.(m?js|json)$/i.test(d.name));
  return link?.name ?? null;
}

function guessMimeType(path: string): string {
  if (/\.m?js$/i.test(path)) return "text/javascript";
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.css$/i.test(path)) return "text/css";
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  if (/\.wasm$/i.test(path)) return "application/wasm";
  return "application/octet-stream";
}

function isJavaScript(mimeType: string, path: string): boolean {
  return (
    mimeType === "text/javascript" ||
    mimeType === "application/javascript" ||
    /\.m?js$/i.test(path)
  );
}

function toBlobPart(content: UnixFileEntry["content"]): BlobPart {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return new Uint8Array(content);
  return String(content);
}

function toUint8Array(content: UnixFileEntry["content"]): Uint8Array {
  if (content instanceof Uint8Array) return content;
  return new TextEncoder().encode(String(content));
}

async function resolveFileHandle(
  repo: Repo,
  folderHandle: DocHandle<FolderDoc>,
  path: string,
): Promise<DocHandle<UnixFileEntry> | undefined> {
  const parts = splitPath(path);

  if (parts.length) {
    const direct = await findHandleInFolderHandle<UnixFileEntry>(
      repo,
      folderHandle,
      parts,
    );
    if (direct) return direct as DocHandle<UnixFileEntry>;
  }

  const pkgHandle = await findHandleInFolderHandle<UnixFileEntry>(
    repo,
    folderHandle,
    ["package.json"],
  );
  if (!pkgHandle) return undefined;

  const pkgDoc = (pkgHandle as DocHandle<UnixFileEntry>).doc();
  if (!pkgDoc?.content) return undefined;

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(String(pkgDoc.content));
  } catch {
    return undefined;
  }

  const subpath = parts.length ? "./" + parts.join("/") : ".";
  let resolved: string | undefined;
  try {
    resolved = resolvePackageExport(pkgJson, subpath, defaultImportConditions);
  } catch {
    return undefined;
  }
  if (!resolved) return undefined;

  const resolvedParts = splitPath(resolved.replace(/^\.\//, ""));
  const target = await findHandleInFolderHandle<UnixFileEntry>(
    repo,
    folderHandle,
    resolvedParts,
  );
  return target as DocHandle<UnixFileEntry> | undefined;
}
