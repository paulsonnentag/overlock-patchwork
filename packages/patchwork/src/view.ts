import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo"

import type { Mount, PatchworkElement } from "./types"

export type Find = {
  <T extends PatchworkElement>(
    predicate: (element: PatchworkElement) => element is T,
  ): T | undefined
  (predicate: (element: PatchworkElement) => boolean): PatchworkElement | undefined
}

export type ViewElement<V = unknown> = PatchworkElement & {
  url: AutomergeUrl | null
  handle: DocHandle<V> | undefined
}

export type ViewProps<V = unknown> = {
  element: ViewElement<V>
  find: Find
  repo: Repo
}

export type ViewFn<V = unknown> = (
  props: ViewProps<V>,
) => undefined | (() => void) | Promise<undefined | (() => void)>

export function defineView<V = unknown>(viewFn: ViewFn<V>): Mount {
  return async (element) => {
    const viewElement = element as ViewElement<V>

    const find = ((predicate: (el: PatchworkElement) => boolean) => {
      let current = element.parentElement
      while (current) {
        if (
          (current as PatchworkElement).isPatchworkView === true &&
          predicate(current as PatchworkElement)
        ) {
          return current as PatchworkElement
        }
        current = current.parentElement
      }
      return undefined
    }) as Find

    const repoContext = find(isRepoContext)
    const repo = repoContext?.value
    if (!repo) throw new Error("no repo found")

    Object.defineProperty(element, "url", {
      get: () => element.getAttribute("url"),
      set: (url) => {
        if (url !== element.getAttribute("url")) {
          element.setAttribute("url", url)
        }
      },
      configurable: true,
    })

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "url") mount()
      }
    })
    observer.observe(element, { attributes: true, attributeFilter: ["url"] })

    let unmount: (() => void) | undefined

    const mount = async () => {
      const url = element.getAttribute("url") as AutomergeUrl | null
      if (url) viewElement.handle = await repo.find(url)

      if (unmount) unmount()
      unmount = await viewFn({ element: viewElement, find, repo })
    }

    mount()

    return () => {
      if (unmount) unmount()
      observer.disconnect()
    }
  }
}

function isRepoContext(
  element: PatchworkElement,
): element is PatchworkElement & { value: Repo } {
  const value = (element as PatchworkElement & { value?: unknown }).value
  return (
    typeof value === "object" &&
    value !== null &&
    "find" in value && typeof (value as { find?: unknown }).find === "function" &&
    "create" in value && typeof (value as { create?: unknown }).create === "function"
  )
}
