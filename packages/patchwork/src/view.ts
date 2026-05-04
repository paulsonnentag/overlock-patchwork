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

    let unmount: (() => void) | undefined

    const unsub = syncProp(element, "url", async (value) => {
      const url = value as AutomergeUrl | null
      if (url) viewElement.handle = await repo.find(url)

      if (unmount) unmount()
      unmount = await viewFn({ element: viewElement, find, repo })
    })

    return () => {
      if (unmount) unmount()
      unsub()
    }
  }
}

function syncProp(
  element: HTMLElement,
  name: string,
  onChange: (value: string | null) => void,
): () => void {
  const pending = (element as unknown as Record<string, unknown>)[name]

  Object.defineProperty(element, name, {
    get: () => element.getAttribute(name),
    set: (value) => {
      if (value == null) {
        if (element.hasAttribute(name)) element.removeAttribute(name)
      } else if (value !== element.getAttribute(name)) {
        element.setAttribute(name, String(value))
      }
    },
    configurable: true,
  })

  if (pending != null) {
    ;(element as unknown as Record<string, unknown>)[name] = pending
  }

  const observer = new MutationObserver(() => {
    onChange(element.getAttribute(name))
  })
  observer.observe(element, { attributes: true, attributeFilter: [name] })

  onChange(element.getAttribute(name))

  return () => observer.disconnect()
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
