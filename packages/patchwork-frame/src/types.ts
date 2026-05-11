import type { AutomergeUrl } from "@automerge/automerge-repo";
import { readHandle, StateHandle, type ElementWithHandle } from "patchwork-dom";

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
