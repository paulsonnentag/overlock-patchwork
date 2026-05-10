import type { AutomergeUrl } from "@automerge/automerge-repo"

import { findHandle } from "patchwork-dom"

import { hasDocumentSelection } from "./types"

const HASH_PREFIX = "#doc="
const URL_SCHEME = "automerge:"

const fromDocId = (id: string): AutomergeUrl =>
  `${URL_SCHEME}${id}` as AutomergeUrl

const toDocId = (url: AutomergeUrl): string =>
  url.startsWith(URL_SCHEME) ? url.slice(URL_SCHEME.length) : url

export default (element: HTMLElement) => {
  const selection = findHandle(element, hasDocumentSelection)
  if (!selection) {
    throw new Error("document-selection-url-sync: no selection ancestor")
  }

  const fromHash = (): AutomergeUrl | null => {
    const hash = location.hash
    if (!hash.startsWith(HASH_PREFIX)) return null
    const raw = hash.slice(HASH_PREFIX.length)
    return raw ? fromDocId(raw) : null
  }

  const applyToHash = () => {
    const url = selection.value.activeDocumentUrl
    const next = url ? `${HASH_PREFIX}${toDocId(url)}` : ""
    if (location.hash === next) return
    if (next) history.replaceState(null, "", next)
    else history.replaceState(null, "", location.pathname + location.search)
  }

  const applyFromHash = () => {
    const url = fromHash()
    if (!url || selection.value.activeDocumentUrl === url) return
    element.dispatchEvent(
      new CustomEvent("open-document", { bubbles: true, detail: { url } }),
    )
  }

  applyFromHash()
  selection.addEventListener("change", applyToHash)
  window.addEventListener("hashchange", applyFromHash)
  return () => {
    selection.removeEventListener("change", applyToHash)
    window.removeEventListener("hashchange", applyFromHash)
  }
}
