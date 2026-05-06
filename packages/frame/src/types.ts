import type { AutomergeUrl } from "@automerge/automerge-repo"
import { StateHandle } from "patchwork-dom"

export type AccountDoc = {
  rootFolderUrl: AutomergeUrl
  packagesFolderUrl: AutomergeUrl
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
  if (!(value instanceof StateHandle)) return false
  const v = value.value as unknown
  return (
    typeof v === "object" &&
    v !== null &&
    "activeDocumentUrl" in v &&
    "openedDocumentUrls" in v
  )
}

export type Manifest = {
  name: string
  importUrl: string
  url: string
  [key: string]: unknown
}

export function isPackageRegistryHandle(
  value: unknown,
): value is StateHandle<Manifest[]> {
  return value instanceof StateHandle && Array.isArray(value.value)
}
