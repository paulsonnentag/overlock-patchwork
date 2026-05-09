import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component as SolidComponent,
} from "solid-js"
import { render } from "solid-js/web"

import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo"
import type { StandardSchemaV1 } from "@standard-schema/spec"

import { findHandle, getRepo, observeAttributes } from "patchwork-dom"
import { hasPluginsProvider } from "patchwork-plugins-provider"
import {
  registerComponent,
  useHandle,
  type ComponentWrapperProps,
} from "patchwork-solid"

type ComponentManifest = {
  type: "component"
  name: string
  module: string
  schema?: string
} & Record<string, unknown>

export default (element: HTMLElement) => {
  const repo = getRepo(element)
  const pluginsHandle = findHandle(element, hasPluginsProvider)
  if (!pluginsHandle) {
    throw new Error("patchwork-view: no <plugins-provider> ancestor")
  }

  const [url, setUrl] = createSignal<string | null>(null)
  const [src, setSrc] = createSignal<string | null>(null)
  const [winnerUrl, setWinnerUrl] = createSignal<string | null>(null)

  // Install the property↔attribute bridge before seeding the signals so
  // any pending property write (e.g. Solid setting `el.url = ...`
  // before mount) is reflected as an attribute first.
  const stopObserving = observeAttributes(element, {
    url: setUrl,
    src: setSrc,
  })
  setUrl(element.getAttribute("url"))
  setSrc(element.getAttribute("src"))

  const plugins = useHandle(pluginsHandle)

  const schemaCache = new Map<
    string,
    Promise<StandardSchemaV1 | undefined>
  >()

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

    for (const [manifestUrl, manifest] of plugins()) {
      if (!isComponentManifest(manifest)) continue
      if (typeof manifest.schema !== "string") continue
      try {
        const schema = await loadSchema(
          schemaCache,
          manifestUrl,
          manifest.schema,
        )
        if (myRun !== runId) return
        if (!schema) continue
        const result = await schema["~standard"].validate(doc)
        if (myRun !== runId) return
        if (!result.issues) {
          setWinnerUrl(manifestUrl)
          return
        }
      } catch (err) {
        console.warn("[patchwork-view] candidate failed:", manifestUrl, err)
      }
    }
    if (myRun !== runId) return
    setWinnerUrl(null)
  }

  createEffect(() => {
    const u = url()
    const s = src()
    plugins()
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
    stopObserving()
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

function isComponentManifest(
  m: Record<string, unknown>,
): m is ComponentManifest {
  return (
    m.type === "component" &&
    typeof m.name === "string" &&
    typeof m.module === "string"
  )
}

function loadSchema(
  cache: Map<string, Promise<StandardSchemaV1 | undefined>>,
  manifestUrl: string,
  schemaPath: string,
): Promise<StandardSchemaV1 | undefined> {
  const absolute = resolveImportUrl(manifestUrl, schemaPath)
  const cached = cache.get(absolute)
  if (cached) return cached
  const promise = (async (): Promise<StandardSchemaV1 | undefined> => {
    const mod = await import(`/${encodeURIComponent(absolute)}`)
    const candidate = (mod as { default?: unknown }).default
    if (!isStandardSchema(candidate)) {
      console.warn(
        `[patchwork-view] schema at ${absolute} is not a Standard Schema (must default-export one)`,
      )
      return undefined
    }
    return candidate
  })()
  cache.set(absolute, promise)
  return promise
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    !!value &&
    typeof value === "object" &&
    "~standard" in value &&
    typeof (value as { "~standard"?: unknown })["~standard"] === "object"
  )
}

// `automerge:` isn't hierarchical for the URL parser, so swap in `http:`
// to do the path math then swap the scheme back.
function resolveImportUrl(baseUrl: string, importUrl: string): string {
  if (!importUrl.startsWith("./") && !importUrl.startsWith("../")) {
    throw new Error(
      `patchwork-view: schema path must start with "./" or "../" (got "${importUrl}")`,
    )
  }
  const FAKE = "http://overlock.invalid/"
  const base = `${FAKE}${baseUrl.slice("automerge:".length)}`
  const resolved = new URL(importUrl, base).href
  if (!resolved.startsWith(FAKE)) {
    throw new Error(
      `patchwork-view: resolved URL escaped package root: "${importUrl}" from ${baseUrl}`,
    )
  }
  return `automerge:${resolved.slice(FAKE.length)}`
}
