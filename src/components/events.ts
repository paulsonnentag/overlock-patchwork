import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

/**
 * Detail payload for a `patchwork:open-document` event. Mirrors the shape
 * patchwork-next ships in `core/elements/src/events.ts` so cross-stack
 * components can interoperate, but kept local to avoid pulling in
 * `@inkandswitch/patchwork-elements` as a runtime dependency.
 *
 * Components fire the event by `dispatchEvent`-ing this constructor on
 * their host element. The framework itself doesn't intercept the event;
 * an enclosing component (typically the app frame) is expected to listen
 * for it on its own element and act on the URL.
 */
export interface OpenDocumentEventDetail {
  url: AutomergeUrl;
}

export class OpenDocumentEvent extends CustomEvent<OpenDocumentEventDetail> {
  constructor(detail: OpenDocumentEventDetail) {
    super("patchwork:open-document", {
      detail,
      composed: true,
      bubbles: true,
    });
  }
}

declare global {
  interface ElementEventMap {
    "patchwork:open-document": OpenDocumentEvent;
  }
  interface ShadowRootEventMap {
    "patchwork:open-document": OpenDocumentEvent;
  }
}
