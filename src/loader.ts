// In-page ES-module loader: resolves an automerge URL + path into a
// blob URL whose source has every static `import` / dynamic
// `import("...")` / `export ... from` rewritten to point at sibling
// blob URLs. Equivalent role to the SW's `resolveAutomergeUrl`
// (patchwork-next/core/bootloader/src/service-worker.ts lines 225-340)
// plus the browser's normal ESM resolution, but staying inside the
// page so it works under file://.
//
// State (the blob URL cache and the optional packages-folder index for
// friendly DevTools names) is per-instance. One instance per page is
// the expected deployment, mirroring the single `Repo` set up in
// `main.ts`. If multiple isolated repos ever live in one page, give
// each its own `Loader`.

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

export type LoaderOptions = {
  repo: Repo;
  packagesRoot?: AutomergeUrl;
};

export class Loader {
  readonly #repo: Repo;
  readonly #blobUrlCache = new Map<CacheKey, Promise<string>>();
  // Optional "packages folder" — when set, scripts whose root document
  // is a direct child of this folder get a friendly DevTools sourceURL
  // of the form `packages/<child-name>/<file>`. `null` until the
  // folder doc has resolved; lookups fall through to the automerge
  // fallback in the meantime.
  #packagesIndex: Map<string, string> | null = null;

  constructor(opts: LoaderOptions) {
    this.#repo = opts.repo;
    if (opts.packagesRoot) this.setPackagesRoot(opts.packagesRoot);
  }

  /**
   * Resolve `url` to an executable ES module: walk the folder doc,
   * rewrite imports, dynamic `import()` of a blob URL.
   */
  async import(url: string): Promise<unknown> {
    await Lexer.init;
    const pinned = await pinUrl(this.#repo, url);
    const { rootUrl, path } = parseAutomergeUrlWithPath(pinned);
    const blobUrl = await this.#materialize(rootUrl, normalizePath(path));
    return import(/* @vite-ignore */ blobUrl);
  }

  /**
   * Register a "packages folder" doc whose direct children get
   * friendly `packages/<name>/<file>` sourceURLs in DevTools. Loaded
   * once and cached; later writes to the packages folder are not
   * picked up until the page reloads. Idempotent — calling twice with
   * the same URL replaces the index.
   */
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

      // Re-derive the canonical path after exports resolution so relative imports
      // inside the module resolve relative to where the file actually lives, not
      // to the subpath that was requested. (e.g. asking for "." may have landed
      // on "dist/index.js"; imports inside should be relative to "dist/".)
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

      // Annotate with `//# sourceURL=…` so DevTools shows a meaningful path
      // instead of the opaque blob: URL. Packages folder children get a
      // `packages/<name>/<file>` URL; everything else falls back to the
      // unpinned automerge URL.
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

    // Resolve every specifier in parallel, then splice end → start so offsets
    // stay valid.
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

    // Bare specifier — caller asked for passthrough behavior. The browser will
    // try to resolve it via an importmap (if the host page provides one) or
    // throw a clear error at import time.
    return null;
  }

  #friendlyRootFor(rootUrl: AutomergeUrl): string {
    const { documentId } = parseAutomergeUrl(rootUrl);
    const pkgName = this.#packagesIndex?.get(documentId);
    if (pkgName) return `packages/${pkgName}`;
    // Unpinned form — drop heads so all heads-versions share one DevTools
    // entry and breakpoints survive HMR.
    return stringifyAutomergeUrl({ documentId });
  }
}

// ── pure URL helpers (re-exported for callers outside the loader) ───

/**
 * Split an `automerge:<docId>[?heads=...][/<path>]` URL into its
 * document URL and its path inside the folder doc. `path` is `""` if
 * the URL has no path component.
 */
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

/**
 * Pin the root of `url` to the document's current heads. Already-pinned
 * URLs are returned unchanged. The path (if any) is preserved.
 *
 * Uncached: each call queries `handle.heads()` afresh. That's cheap and
 * intentional — callers (notably `PluginRegistry`'s HMR path) rely on
 * seeing fresh heads to invalidate the loader's blob cache.
 */
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

// ── private helpers ─────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function resolveRelative(fromFile: string, spec: string): string {
  // Resolve relative to the *directory* of `fromFile`. `URL` does the right
  // thing here as long as we use a fake hierarchical base.
  const base = "fake:///" + fromFile;
  const u = new URL(spec, base);
  return normalizePath(u.pathname);
}

function canonicalPathOf(
  folderHandle: DocHandle<FolderDoc>,
  _fileHandle: DocHandle<UnixFileEntry>,
  requestedPath: string,
): string | null {
  // The walker in resolveFileHandle already followed the path; for the v1 we
  // assume direct path lookups land on the requested path. If they didn't
  // (because exports kicked in) we fall back to walking the folder tree to
  // find the link that points to the file. Cheap and rarely needed.
  if (requestedPath && !requestedPath.endsWith("/")) return requestedPath;
  const folder = folderHandle.doc();
  if (!folder?.docs?.length) return null;
  // Best-effort: pick the first link that names something with a JS extension.
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
  // ImmutableString — coerce to a real string.
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
