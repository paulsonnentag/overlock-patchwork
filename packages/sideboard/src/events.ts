import type { AutomergeUrl } from "@automerge/automerge-repo";

export type OpenDocumentEventDetail = {
  url: AutomergeUrl;
  toolId?: string;
  title?: string;
  type?: string;
};

export function createOpenEvent(detail: OpenDocumentEventDetail) {
  const openEvent = new CustomEvent("open-document", {
    detail,
    bubbles: true,
    composed: true,
  });
  return openEvent;
}
