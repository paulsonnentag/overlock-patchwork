import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo"

import { getRepo } from "./find"
import { observeAttributes } from "./observe-attributes"
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

    // Install the property↔attribute bridge before the initial read so
    // any pending `el.url = ...` write (e.g. Solid setting the prop
    // before mount ran) is reflected as an attribute first.
    const stopObserving = observeAttributes(element, {
      url: (value) => {
        void onUrlChange(value)
      },
    })

    // Run the first mount synchronously so callers awaiting mount(el)
    // (and `patchwork:mounted` listeners that fire afterwards) observe
    // a fully set-up element.
    await onUrlChange(element.getAttribute("url"))

    return () => {
      if (unmount) unmount()
      stopObserving()
    }
  }
}
