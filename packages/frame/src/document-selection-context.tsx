import type { AutomergeUrl } from "@automerge/automerge-repo"

import { defineView, StateHandle, ViewElement } from "patchwork-solid"

import type { DocumentSelection } from "./types"

export default (element: ViewElement) => {
  const handle = new StateHandle<DocumentSelection>(
    { activeDocumentUrl: null, openedDocumentUrls: [] },
    selectionEquals,
  )
  Object.assign(element, { value: handle })
  element.style.display = "contents"

  const onOpen = (e: Event) => {
    const url = (e as CustomEvent<{ url: AutomergeUrl }>).detail.url
    const cur = handle.value
    handle.change({
      activeDocumentUrl: url,
      openedDocumentUrls: cur.openedDocumentUrls.includes(url)
        ? cur.openedDocumentUrls
        : [...cur.openedDocumentUrls, url],
    })
  }

  const onClose = (e: Event) => {
    const url = (e as CustomEvent<{ url: AutomergeUrl }>).detail.url
    const cur = handle.value
    const opened = cur.openedDocumentUrls.filter((u) => u !== url)
    handle.change({
      openedDocumentUrls: opened,
      activeDocumentUrl:
        cur.activeDocumentUrl === url
          ? (opened[opened.length - 1] ?? null)
          : cur.activeDocumentUrl,
    })
  }

  element.addEventListener("open-document", onOpen)
  element.addEventListener("close-document", onClose)
  return () => {
    element.removeEventListener("open-document", onOpen)
    element.removeEventListener("close-document", onClose)
  }
}

function selectionEquals(a: DocumentSelection, b: DocumentSelection): boolean {
  if (a.activeDocumentUrl !== b.activeDocumentUrl) return false
  if (a.openedDocumentUrls.length !== b.openedDocumentUrls.length) return false
  for (let i = 0; i < a.openedDocumentUrls.length; i++) {
    if (a.openedDocumentUrls[i] !== b.openedDocumentUrls[i]) return false
  }
  return true
}
