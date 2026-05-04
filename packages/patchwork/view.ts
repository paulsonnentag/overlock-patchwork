import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo"

export type ViewElement<P extends { handle?: unknown; value?: unknown } = {}> = HTMLElement & {
  isPatchworkView: true
  url?: AutomergeUrl
  handle?: DocHandle<P extends { handle: infer H } ? H : unknown>
  value?: P extends { value: infer V } ? V : unknown
}

export type ViewProps<P extends { handle?: unknown; value?: unknown } = {}> = {
  element: ViewElement<P>
  find: (predicate: (element: ViewElement) => boolean) => ViewElement | undefined
  repo: Repo
}

export type ViewFn<P extends { handle?: unknown; value?: unknown } = {}> = (
  props: ViewProps<P>,
) => undefined | (() => void) | Promise<undefined | (() => void)>

export type Mount<P extends { handle?: unknown; value?: unknown } = {}> = (
  element: HTMLElement,
) => Promise<(() => void) | null>

export function defineView<P extends { handle?: unknown; value?: unknown } = {}>(
  viewFn: ViewFn<P>
): Mount<P> {
  return async (element) => {
    const viewElement = element as ViewElement<P>

    const find = <T extends ViewElement>(
      predicate: (element: ViewElement) => boolean,
    ): T | undefined => {
      let current = element.parentElement
      while (current) {
        if (
          (current as any).isPatchworkView === true &&
          predicate(current as ViewElement)
        ) {
          return current as T
        }
        current = current.parentElement
      }
      return undefined
    }

    const repoContext = find<ViewElement<{ value: Repo }>>(isRepo)
    const repo = repoContext?.value

    if (!repo) {
      throw new Error("no repo found")
    }

    Object.defineProperty(element, "url", {
      get: () => element.getAttribute("url"),
      set: (url) => {
        if (url !== element.getAttribute("url")) {
          element.setAttribute("url", url)
          mount()
        }
      },
      configurable: true
    })

    const mutationObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "url") {
          viewElement.url = viewElement.getAttribute("url") as AutomergeUrl
        }
      }
    })
    mutationObserver.observe(element, { attributes: true, attributeFilter: ["url"] })

    let unmount : (() => void) | undefined

    const mount = async () => {
      const url = element.getAttribute("url") as AutomergeUrl

      if (url) {
        viewElement.handle = await repo.find(url)
      }

      if (unmount) {
        unmount()
      }

      unmount = await viewFn({
        element: viewElement,
        find,
        repo,
      })
    }

    mount()

    return () => {
      if (unmount) {
        unmount()    
      }
      mutationObserver.disconnect()
    }
  }
}

function isRepo({ value }: ViewElement<{ value: unknown }>) {
  return (
    typeof value === "object" &&
    value !== null &&
    "find" in value && typeof (value as any).find === "function" &&
    "create" in value && typeof (value as any).create === "function"
  )
}
