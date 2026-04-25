// File-resolution helpers vendored (and lightly adapted) from
// patchwork-next/core/filesystem/src/{index,packages}.ts.

import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { resolve as resolveExports } from "resolve.exports";
import type { FileDoc, FolderDoc } from "./types";

export const defaultImportConditions = ["overlock", "browser", "import"];

export async function findHandleInFolderHandle<T>(
  repo: Repo,
  folderHandle: DocHandle<FolderDoc>,
  parts: string[],
): Promise<DocHandle<T> | undefined> {
  if (!parts.length) return folderHandle as unknown as DocHandle<T>;
  const part = parts[0];
  if (!part) return folderHandle as unknown as DocHandle<T>;
  const folder = folderHandle.doc();
  if (!folder?.docs) return undefined;

  const docLink = folder.docs.find((d) => d.name === part);
  if (!docLink) return undefined;

  const docHandle = await repo.find(docLink.url);

  if (parts.length > 1) {
    const doc = docHandle.doc() as unknown;
    if (!doc || typeof doc !== "object" || !("docs" in doc)) {
      return undefined;
    }
    return findHandleInFolderHandle<T>(
      repo,
      docHandle as DocHandle<FolderDoc>,
      parts.slice(1),
    );
  }
  return docHandle as DocHandle<T>;
}

export function resolvePackageExport(
  pkgJson: Record<string, unknown>,
  subpath: string = ".",
  conditions: string[] = defaultImportConditions,
): string | undefined {
  try {
    const resolved = resolveExports(pkgJson, subpath, { conditions });
    if (resolved && resolved.length) return resolved[0];
  } catch {
    // fall through
  }
  if (subpath === "." && typeof pkgJson.main === "string") {
    return pkgJson.main as string;
  }
  return undefined;
}

/**
 * Resolve `(folderUrl, path)` to a `DocHandle<FileDoc>` exactly the way the
 * patchwork service worker does (lines 249-315 of
 * core/bootloader/src/service-worker.ts): try direct path, then `package.json`
 * `exports` for either the named subpath or the root.
 */
export async function resolveFileHandle(
  repo: Repo,
  folderHandle: DocHandle<FolderDoc>,
  path: string,
): Promise<DocHandle<FileDoc> | undefined> {
  const parts = splitPath(path);

  if (parts.length) {
    const direct = await findHandleInFolderHandle<FileDoc>(
      repo,
      folderHandle,
      parts,
    );
    if (direct) return direct;
  }

  // Fall back to package.json exports (root or named subpath).
  const pkgHandle = await findHandleInFolderHandle<FileDoc>(
    repo,
    folderHandle,
    ["package.json"],
  );
  if (!pkgHandle) return undefined;

  const pkgDoc = pkgHandle.doc();
  if (!pkgDoc?.content) return undefined;

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(String(pkgDoc.content));
  } catch {
    return undefined;
  }

  const subpath = parts.length ? "./" + parts.join("/") : ".";
  const resolved = resolvePackageExport(pkgJson, subpath);
  if (!resolved) return undefined;

  const resolvedParts = splitPath(resolved.replace(/^\.\//, ""));
  return findHandleInFolderHandle<FileDoc>(repo, folderHandle, resolvedParts);
}

function splitPath(p: string): string[] {
  return p
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean);
}
