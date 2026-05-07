import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo"
import { StateHandle } from "patchwork-dom"

export type AccountDoc = {
  rootFolderUrl: AutomergeUrl
  packagesFolderUrl: AutomergeUrl
}

export function hasAccountHandle(
  el: HTMLElement,
): el is HTMLElement & { handle: DocHandle<AccountDoc> } {
  const handle = (el as HTMLElement & { handle?: unknown }).handle
  if (!handle || typeof handle !== "object") return false
  const doc = (handle as DocHandle<unknown>).doc?.() as
    | { rootFolderUrl?: unknown; packagesFolderUrl?: unknown }
    | undefined
  return (
    typeof doc?.rootFolderUrl === "string" &&
    typeof doc?.packagesFolderUrl === "string"
  )
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

export function hasDocumentSelection(
  el: HTMLElement,
): el is HTMLElement & { handle: StateHandle<DocumentSelection> } {
  const handle = (el as HTMLElement & { handle?: unknown }).handle
  if (!(handle instanceof StateHandle)) return false
  const v = handle.value as unknown
  return (
    typeof v === "object" &&
    v !== null &&
    "activeDocumentUrl" in v &&
    "openedDocumentUrls" in v
  )
}

export type Component = {
  name: string
  module: string
  url: string
  [key: string]: unknown
}
