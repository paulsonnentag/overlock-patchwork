import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo"

import type { Mount } from "./types"

export type Find = {
  <T extends HTMLElement>(
    predicate: (element: HTMLElement) => element is T,
  ): T | undefined
  (predicate: (element: HTMLElement) => boolean): HTMLElement | undefined
}

export type ViewElement<V = unknown> = HTMLElement & {
  url: AutomergeUrl | null
  handle: DocHandle<V> | undefined
}

export type RegisterView = (url: string) => Promise<string>

export type ViewProps<V = unknown> = {
  element: ViewElement<V>
  find: Find
  repo: Repo
  registerView: RegisterView
}

export type ViewFn<V = unknown> = (
  props: ViewProps<V>,
) => undefined | (() => void) | Promise<undefined | (() => void)>

export function defineView<V = unknown>(viewFn: ViewFn<V>): Mount {
  return async (element) => {
    const viewElement = element as ViewElement<V>

    const find = ((predicate: (el: HTMLElement) => boolean) => {
      let current = element.parentElement
      while (current) {
        if (predicate(current)) return current
        current = current.parentElement
      }
      return undefined
    }) as Find

    const repoContext = find(isRepoContext)
    const repo = repoContext?.value
    if (!repo) throw new Error("no repo found")

    const registryContext = find(isRegistryContext)
    const registry = registryContext?.value
    if (!registry) throw new Error("no registry found")
    const registerView: RegisterView = (url) => registry.registerView(url)

    let unmount: (() => void) | undefined

    const onUrlChange = async (value: string | null): Promise<void> => {
      const url = value as AutomergeUrl | null
      if (url) viewElement.handle = await repo.find(url)

      if (unmount) unmount()
      unmount = await viewFn({ element: viewElement, find, repo, registerView })
    }

    // Mirror the `url` attribute onto the element property. Captures any
    // value already assigned before the property was redefined (e.g. by
    // Solid setting `el.url = ...` before mount runs).
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

    // Run the first mount synchronously so callers awaiting `mount(el)`
    // (and patchwork:mounted listeners that fire afterwards) observe a
    // fully-set-up element.
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

function isRepoContext(
  element: HTMLElement,
): element is HTMLElement & { value: Repo } {
  const value = (element as HTMLElement & { value?: unknown }).value
  return (
    typeof value === "object" &&
    value !== null &&
    "find" in value && typeof (value as { find?: unknown }).find === "function" &&
    "create" in value && typeof (value as { create?: unknown }).create === "function"
  )
}

function isRegistryContext(
  element: HTMLElement,
): element is HTMLElement & { value: { registerView: RegisterView } } {
  const value = (element as HTMLElement & { value?: unknown }).value
  return (
    typeof value === "object" &&
    value !== null &&
    "registerView" in value &&
    typeof (value as { registerView?: unknown }).registerView === "function"
  )
}
