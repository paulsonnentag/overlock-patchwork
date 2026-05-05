import type { AutomergeUrl } from "@automerge/automerge-repo"
import { StateHandle } from "patchwork-solid"

export type AccountDoc = {
  rootFolderUrl: AutomergeUrl
}

export type DocLink = {
  name: string
  type: string
  url: AutomergeUrl
  icon?: string
}

export type FolderDoc = {
  title: string
  docs: DocLink[]
}

export type DocumentSelection = {
  activeDocumentUrl: AutomergeUrl | null
  openedDocumentUrls: AutomergeUrl[]
}

export function isDocumentSelectionHandle(
  value: unknown,
): value is StateHandle<DocumentSelection> {
  return value instanceof StateHandle
}
