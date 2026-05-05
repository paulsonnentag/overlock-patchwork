import type { AutomergeUrl } from "@automerge/automerge-repo"

import { defineView, findContext } from "patchwork-solid"

import { isDocumentSelectionHandle, type DocumentSelection } from "./types"

const HASH_PREFIX = "#doc="

export default defineView(({ element }) => {
  const sel = findContext(element, isDocumentSelectionHandle)
  if (!sel) throw new Error("document-selection-url-sync: no selection context")

  const fromHash = (): AutomergeUrl | null => {
    const hash = location.hash
    if (!hash.startsWith(HASH_PREFIX)) return null
    const raw = hash.slice(HASH_PREFIX.length)
    return raw ? (decodeURIComponent(raw) as AutomergeUrl) : null
  }

  const applyToHash = () => {
    const url = sel.value.activeDocumentUrl
    const next = url ? `${HASH_PREFIX}${encodeURIComponent(url)}` : ""
    if (location.hash === next) return
    if (next) history.replaceState(null, "", next)
    else history.replaceState(null, "", location.pathname + location.search)
  }

  const applyFromHash = () => {
    const url = fromHash()
    if (!url || sel.value.activeDocumentUrl === url) return
    element.dispatchEvent(
      new CustomEvent("open-document", { bubbles: true, detail: { url } }),
    )
  }

  applyFromHash()
  sel.addEventListener("change", applyToHash)
  window.addEventListener("hashchange", applyFromHash)
  return () => {
    sel.removeEventListener("change", applyToHash)
    window.removeEventListener("hashchange", applyFromHash)
  }
})
