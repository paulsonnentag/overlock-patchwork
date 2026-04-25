// Recursively resolve an automerge URL + path into a blob URL whose source has
// every static `import` / dynamic `import("...")` / `export ... from` rewritten
// to point at sibling blob URLs. Equivalent role to the SW's
// `resolveAutomergeUrl` (patchwork-next/core/bootloader/src/service-worker.ts
// lines 225-340) plus the browser's normal ESM resolution, but staying inside
// the page so it works under file://.

import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { init as lexerInit, parse as lexerParse } from "es-module-lexer";

import { resolveFileHandle } from "./resolve";
import type { FileDoc, FolderDoc } from "./types";

type CacheKey = string;
const blobUrlCache = new Map<CacheKey, Promise<string>>();
const pinnedRootCache = new Map<AutomergeUrl, Promise<AutomergeUrl>>();

export interface ImportOptions {
  /**
   * If true (default), every cross-doc reference is pinned to the doc's heads
   * at first sight, so the resulting graph is reproducible and the cache is
   * keyed on a stable identity. Disable only for live reload experiments.
   */
  pinHeads?: boolean;
}

export async function automergeImport(
  repo: Repo,
  rootUrl: AutomergeUrl,
  path: string,
  options: ImportOptions = {},
): Promise<unknown> {
  await lexerInit;
  const root = options.pinHeads === false ? rootUrl : await pinHeads(repo, rootUrl);
  const blobUrl = await materialize(repo, root, normalizePath(path), options);
  return import(/* @vite-ignore */ blobUrl);
}

// ── core resolution ────────────────────────────────────────────────────

async function materialize(
  repo: Repo,
  rootUrl: AutomergeUrl,
  path: string,
  options: ImportOptions,
  inFlight: Set<CacheKey> = new Set(),
): Promise<string> {
  const key = `${rootUrl}|${path}`;
  const cached = blobUrlCache.get(key);
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
    const folderHandle = await repo.find<FolderDoc>(rootUrl);
    const fileHandle = await resolveFileHandle(repo, folderHandle, path);
    if (!fileHandle) {
      throw new Error(`overlock: could not resolve "${path}" in ${rootUrl}`);
    }

    // Re-derive the canonical path after exports resolution so relative imports
    // inside the module resolve relative to where the file actually lives, not
    // to the subpath that was requested. (e.g. asking for "." may have landed
    // on "dist/index.js"; imports inside should be relative to "dist/").
    const canonicalPath = canonicalPathOf(folderHandle, fileHandle, path);

    const fileDoc = fileHandle.doc() as FileDoc;
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
        : new TextDecoder().decode(content);

    const rewritten = await rewriteImports(
      repo,
      rootUrl,
      canonicalPath ?? path,
      source,
      options,
      inFlight,
    );

    const blob = new Blob([rewritten], { type: "text/javascript" });
    return URL.createObjectURL(blob);
  })().finally(() => {
    inFlight.delete(key);
  });

  blobUrlCache.set(key, promise);
  return promise;
}

async function rewriteImports(
  repo: Repo,
  rootUrl: AutomergeUrl,
  fromPath: string,
  source: string,
  options: ImportOptions,
  inFlight: Set<CacheKey>,
): Promise<string> {
  const [imports] = lexerParse(source);

  // Resolve every specifier in parallel, then splice end → start so offsets
  // stay valid.
  const resolved = await Promise.all(
    imports.map(async (imp) => {
      const spec = imp.n;
      if (!spec) return null;
      try {
        const replacement = await resolveSpecifier(
          repo,
          rootUrl,
          fromPath,
          spec,
          options,
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

async function resolveSpecifier(
  repo: Repo,
  rootUrl: AutomergeUrl,
  fromPath: string,
  spec: string,
  options: ImportOptions,
  inFlight: Set<CacheKey>,
): Promise<string | null> {
  if (spec.startsWith("automerge:")) {
    const slash = spec.indexOf("/", "automerge:".length);
    const urlPart = (slash === -1 ? spec : spec.slice(0, slash)) as AutomergeUrl;
    const subpath = slash === -1 ? "." : spec.slice(slash + 1);
    if (!isValidAutomergeUrl(urlPart)) {
      throw new Error(`not a valid automerge URL: "${urlPart}"`);
    }
    const pinned = options.pinHeads === false ? urlPart : await pinHeads(repo, urlPart);
    return materialize(repo, pinned, normalizePath(subpath), options, inFlight);
  }

  if (spec.startsWith("./") || spec.startsWith("../")) {
    const resolvedPath = resolveRelative(fromPath, spec);
    return materialize(repo, rootUrl, resolvedPath, options, inFlight);
  }

  if (spec.startsWith("/")) {
    return materialize(repo, rootUrl, normalizePath(spec), options, inFlight);
  }

  // Bare specifier — caller asked for passthrough behavior. The browser will
  // try to resolve it via an importmap (if the host page provides one) or
  // throw a clear error at import time.
  return null;
}

// ── helpers ────────────────────────────────────────────────────────────

function pinHeads(repo: Repo, url: AutomergeUrl): Promise<AutomergeUrl> {
  const cached = pinnedRootCache.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const { documentId, heads } = parseAutomergeUrl(url);
    if (heads && heads.length) return url;
    const handle = await repo.find(url);
    return stringifyAutomergeUrl({
      documentId,
      heads: handle.heads(),
    });
  })();
  pinnedRootCache.set(url, promise);
  return promise;
}

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
  _fileHandle: DocHandle<FileDoc>,
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

function toBlobPart(content: string | Uint8Array): BlobPart {
  if (typeof content === "string") return content;
  // Re-wrap to detach from automerge's internal buffer if needed.
  return new Uint8Array(content);
}
