// Document shapes used by pushwork. Mirrors
// patchwork-next/core/filesystem/src/types.ts.

import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

export type DocLink = {
  name: string;
  type: string;
  url: AutomergeUrl;
  icon?: string;
  copyOf?: AutomergeUrl;
};

export type FolderDoc = {
  title?: string;
  docs: DocLink[];
  lastSyncAt?: number;
};

export type FileDoc = {
  content: string | Uint8Array;
  mimeType?: string;
  extension?: string;
  name?: string;
};
