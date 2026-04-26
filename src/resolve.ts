import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import {
  defaultImportConditions,
  findHandleInFolderHandle,
  resolvePackageExport,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

/**
 * Resolve `(folderUrl, path)` to a `DocHandle<UnixFileEntry>` exactly the way
 * the patchwork service worker does (lines 249-315 of
 * core/bootloader/src/service-worker.ts): try direct path, then `package.json`
 * `exports` for either the named subpath or the root.
 */
export async function resolveFileHandle(
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

function splitPath(p: string): string[] {
  return p
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean);
}
