import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { readHandle, StateHandle, type ElementWithHandle } from "patchwork-dom";

export type AccountDoc = {
  rootFolderUrl: AutomergeUrl;
  packagesFolderUrl: AutomergeUrl;
};

export function hasAccountHandle(
  el: HTMLElement
): el is ElementWithHandle<DocHandle<AccountDoc>> {
  const handle = readHandle(el);
  if (!handle || typeof handle !== "object") return false;
  const doc = (handle as DocHandle<unknown>).doc?.() as
    | { rootFolderUrl?: unknown; packagesFolderUrl?: unknown }
    | undefined;
  return (
    typeof doc?.rootFolderUrl === "string" &&
    typeof doc?.packagesFolderUrl === "string"
  );
}

export type DocumentSelection = {
  activeDocumentUrl: AutomergeUrl | null;
  openedDocumentUrls: AutomergeUrl[];
};

export function hasDocumentSelection(
  el: HTMLElement
): el is ElementWithHandle<StateHandle<DocumentSelection>> {
  const handle = readHandle(el);
  if (!(handle instanceof StateHandle)) return false;
  const v = handle.value as unknown;
  return (
    typeof v === "object" &&
    v !== null &&
    "activeDocumentUrl" in v &&
    "openedDocumentUrls" in v
  );
}
