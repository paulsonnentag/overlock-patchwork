import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo"

import { getRepo } from "./find"
import type { MountFn, MountResult } from "./types"

export type ElementWithDocHandle<V = unknown> = HTMLElement & {
  url: AutomergeUrl | null
  handle: DocHandle<V> | undefined
}

export type DocHandleCtx<V> = {
  element: ElementWithDocHandle<V>
  handle: DocHandle<V>
  repo: Repo
}

export function withDocHandle<V = unknown>(
  next: (ctx: DocHandleCtx<V>) => MountResult,
): MountFn {
  return async (input) => {
    const element = input as ElementWithDocHandle<V>
    const repo = getRepo(element)
    mirrorUrlAttribute(element)

    let unmount: (() => void) | undefined

    const onUrlChange = async (raw: string | null): Promise<void> => {
      if (unmount) unmount()
      unmount = undefined

      const url = raw as AutomergeUrl | null
      element.handle = url ? await repo.find<V>(url) : undefined
      if (!element.handle || !url) return

      const result = await next({
        element,
        handle: element.handle,
        repo,
      })
      unmount = typeof result === "function" ? result : undefined
    }

    // Run the first mount synchronously so callers awaiting mount(el)
    // (and `patchwork:mounted` listeners that fire afterwards) observe
    // a fully set-up element.
    await onUrlChange(element.getAttribute("url"))

    const observer = new MutationObserver(() => {
      void onUrlChange(element.getAttribute("url"))
    })
    observer.observe(element, { attributes: true, attributeFilter: ["url"] })

    return () => {
      if (unmount) unmount()
      observer.disconnect()
    }
  }
}

// Captures any value already assigned before the property was redefined
// (e.g. by Solid setting `el.url = ...` before mount runs).
function mirrorUrlAttribute(element: HTMLElement): void {
  const pending = (element as unknown as Record<string, unknown>)["url"]
  Object.defineProperty(element, "url", {
    get: () => element.getAttribute("url"),
    set: (value) => {
      if (value == null) {
        if (element.hasAttribute("url")) element.removeAttribute("url")
      } else if (value !== element.getAttribute("url")) {
        element.setAttribute("url", String(value))
      }
    },
    configurable: true,
  })
  if (pending != null) {
    ;(element as unknown as Record<string, unknown>)["url"] = pending
  }
}
