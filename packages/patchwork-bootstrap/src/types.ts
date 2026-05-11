import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { readHandle, type ElementWithHandle } from "patchwork-dom";

export type AccountDoc = {
  rootFolderUrl: AutomergeUrl;
  packagesFolderUrl: AutomergeUrl;
  frameUrl: AutomergeUrl;
};

export function hasAccountHandle(
  el: HTMLElement
): el is ElementWithHandle<DocHandle<AccountDoc>> {
  const handle = readHandle(el);
  if (!handle || typeof handle !== "object") return false;
  const doc = (handle as DocHandle<unknown>).doc?.() as
    | {
        rootFolderUrl?: unknown;
        packagesFolderUrl?: unknown;
        frameUrl?: unknown;
      }
    | undefined;
  return (
    typeof doc?.rootFolderUrl === "string" &&
    typeof doc?.packagesFolderUrl === "string" &&
    typeof doc?.frameUrl === "string"
  );
}
