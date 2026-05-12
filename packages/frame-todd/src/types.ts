import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  isStateHandle,
  readHandle,
  type ElementWithHandle,
  type StateHandleLike,
} from "patchwork-dom";

export type DocumentSelection = {
  activeDocumentUrl: AutomergeUrl | null;
  openedDocumentUrls: AutomergeUrl[];
};

// Duck-typed because the provider component was bundled by a different
// package (with its own copy of patchwork-dom), so `instanceof
// StateHandle` against our local class would always fail.
export function hasDocumentSelection(
  el: HTMLElement
): el is ElementWithHandle<StateHandleLike<DocumentSelection>> {
  const handle = readHandle(el);
  if (!isStateHandle(handle)) return false;
  const v = handle.value as unknown;
  return (
    typeof v === "object" &&
    v !== null &&
    "activeDocumentUrl" in v &&
    "openedDocumentUrls" in v
  );
}
