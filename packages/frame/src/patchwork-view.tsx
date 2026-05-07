import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component as SolidComponent,
} from "solid-js"
import { render } from "solid-js/web"

import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo"

import { findHandle, getModuleWatcher, getRepo } from "patchwork-dom"
import {
  registerComponent,
  useHandle,
  type ComponentWrapperProps,
} from "patchwork-solid"

import { hasComponentRegistry } from "./types"

export default (element: HTMLElement) => {
  const repo = getRepo(element)
  const moduleWatcher = getModuleWatcher(element)
  const registryHandle = findHandle(element, hasComponentRegistry)
  if (!registryHandle) {
    throw new Error(
      "patchwork-view: no <package-registry-provider> ancestor",
    )
  }

  mirrorAttribute(element, "url")
  mirrorAttribute(element, "src")

  const [url, setUrl] = createSignal<string | null>(
    element.getAttribute("url"),
  )
  const [src, setSrc] = createSignal<string | null>(
    element.getAttribute("src"),
  )
  const [winnerUrl, setWinnerUrl] = createSignal<string | null>(null)

  const observer = new MutationObserver(() => {
    setUrl(element.getAttribute("url"))
    setSrc(element.getAttribute("src"))
  })
  observer.observe(element, {
    attributes: true,
    attributeFilter: ["url", "src"],
  })

  const components = useHandle(registryHandle)

  // Re-attach to the live doc on every probe so doc-change events
  // re-trigger discovery; cancellation is handled by `runId`.
  let runId = 0
  let attached: { handle: DocHandle<unknown>; onChange: () => void } | undefined
  const detach = () => {
    if (!attached) return
    attached.handle.off("change", attached.onChange)
    attached = undefined
  }

  const probe = async (u: string | null, s: string | null): Promise<void> => {
    const myRun = ++runId
    detach()

    if (!u) {
      setWinnerUrl(null)
      return
    }
    if (s) {
      setWinnerUrl(s)
      return
    }

    const handle = await repo.find<unknown>(u as AutomergeUrl)
    if (myRun !== runId) return

    const onChange = () => {
      void probe(url(), src())
    }
    handle.on("change", onChange)
    attached = { handle, onChange }

    const doc = handle.doc()
    if (doc == null) {
      setWinnerUrl(null)
      return
    }

    for (const candidate of components()) {
      try {
        const loaded = await moduleWatcher.load(candidate.url)
        if (myRun !== runId) return
        if (!loaded.schema) continue
        const result = await loaded.schema["~standard"].validate(doc)
        if (myRun !== runId) return
        if (!result.issues) {
          setWinnerUrl(candidate.url)
          return
        }
      } catch (err) {
        console.warn(
          "[patchwork-view] candidate failed:",
          candidate.url,
          err,
        )
      }
    }
    if (myRun !== runId) return
    setWinnerUrl(null)
  }

  createEffect(() => {
    const u = url()
    const s = src()
    components()
    void probe(u, s)
  })

  // Cache the registered Solid Component per url so a stable winner
  // doesn't tear down and rebuild the mounted element on every render.
  const componentByUrl = new Map<
    string,
    SolidComponent<ComponentWrapperProps>
  >()
  const ResolvedComponent = createMemo(() => {
    const u = winnerUrl()
    if (!u) return null
    let c = componentByUrl.get(u)
    if (!c) {
      c = registerComponent(element, u)
      componentByUrl.set(u, c)
    }
    return c
  })

  const view = createMemo(() => {
    const u = url()
    const C = ResolvedComponent()
    if (!u || !C) return null
    return { url: u, Comp: C }
  })

  const dispose = render(
    () => (
      <Show when={view()} fallback={<EmptyState />}>
        {(v) => {
          const Comp = v().Comp
          return <Comp url={v().url} />
        }}
      </Show>
    ),
    element,
  )

  return () => {
    runId++
    detach()
    observer.disconnect()
    dispose()
  }
}

function EmptyState() {
  return (
    <div class="patchwork-view__empty">
      <em>No component for this document.</em>
    </div>
  )
}

function mirrorAttribute(element: HTMLElement, name: string): void {
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
}
