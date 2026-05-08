import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo"

import {
  getRepo,
  readHandle,
  StateHandle,
  type ElementWithHandle,
} from "patchwork-dom"

import type {
  FolderDoc,
  UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem"

export type Plugin = {
  name: string
  module: string
  url: string
  [key: string]: unknown
}

type PluginEntry = {
  name: string
  module: string
  [key: string]: unknown
}

export function hasPluginsProvider(
  el: HTMLElement,
): el is ElementWithHandle<StateHandle<Plugin[]>> {
  const handle = readHandle(el)
  if (!(handle instanceof StateHandle)) return false
  return Array.isArray(handle.value)
}

export default (element: HTMLElement) => {
  const repo = getRepo(element)
  const state = new StateHandle<Plugin[]>([], pluginsEqual)
  Object.assign(element, { handle: state })
  element.style.display = "contents"

  const folders = new Map<string, DocHandle<FolderDoc>>()
  const pkgJsons = new Map<string, DocHandle<UnixFileEntry>>()

  let cancelled = false
  let scheduled = false
  let runId = 0
  let rootHandle: DocHandle<FolderDoc> | undefined

  const onChange = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      void rebuild()
    })
  }

  async function rebuild(): Promise<void> {
    if (cancelled || !rootHandle) return
    const myRunId = ++runId
    const nextFolders = new Map<string, DocHandle<FolderDoc>>()
    const nextPkgJsons = new Map<string, DocHandle<UnixFileEntry>>()
    const nextPlugins: Plugin[] = []

    const queue: DocHandle<FolderDoc>[] = [rootHandle]
    while (queue.length > 0) {
      const folder = queue.shift()!
      const folderKey = canonicalKey(folder.url)
      if (nextFolders.has(folderKey)) continue
      nextFolders.set(folderKey, folder)

      const docs = folder.doc()?.docs ?? []
      const pkgLink = docs.find((d) => d.name === "package.json")
      if (pkgLink) {
        const pkgHandle = (await repo.find(pkgLink.url)) as DocHandle<UnixFileEntry>
        if (myRunId !== runId) return
        const pkgJsonKey = canonicalKey(pkgHandle.url)
        nextPkgJsons.set(pkgJsonKey, pkgHandle)

        const pkgJson = parseJson(pkgHandle.doc()?.content)
        const plugins = readPluginEntries(pkgJson)
        if (plugins.length > 0) {
          const packageJsonUrl = `${canonicalUrl(folder.url)}/package.json`
          for (const entry of plugins) {
            nextPlugins.push({
              ...entry,
              url: `${packageJsonUrl}#components/${entry.name}`,
              module: resolveImportUrl(packageJsonUrl, entry.module),
            })
          }
        }
      }

      for (const link of docs) {
        if (link.name === "package.json") continue
        const childHandle = await repo.find(link.url)
        if (myRunId !== runId) return
        if (isFolderDocHandle(childHandle)) {
          queue.push(childHandle as DocHandle<FolderDoc>)
        }
      }
    }

    if (myRunId !== runId) return

    reconcile(folders, nextFolders, onChange)
    reconcile(pkgJsons, nextPkgJsons, onChange)

    state.change(nextPlugins)
  }

  const onUrl = async (raw: string | null) => {
    runId++
    for (const handle of folders.values()) handle.off("change", onChange)
    for (const handle of pkgJsons.values()) handle.off("change", onChange)
    folders.clear()
    pkgJsons.clear()

    if (!raw) {
      rootHandle = undefined
      state.change([])
      return
    }
    const next = await repo.find<FolderDoc>(raw as AutomergeUrl)
    if (cancelled) return
    rootHandle = next
    void rebuild()
  }

  void onUrl(element.getAttribute("url"))

  const observer = new MutationObserver(() => {
    void onUrl(element.getAttribute("url"))
  })
  observer.observe(element, { attributes: true, attributeFilter: ["url"] })

  return () => {
    cancelled = true
    runId++
    observer.disconnect()
    for (const handle of folders.values()) handle.off("change", onChange)
    for (const handle of pkgJsons.values()) handle.off("change", onChange)
    folders.clear()
    pkgJsons.clear()
  }
}

function readPluginEntries(pkgJson: unknown): PluginEntry[] {
  if (pkgJson == null || typeof pkgJson !== "object") return []
  const contributions = (pkgJson as { contributions?: unknown }).contributions
  if (contributions == null || typeof contributions !== "object") return []
  const components = (contributions as { components?: unknown }).components
  if (!Array.isArray(components)) return []
  return components.filter(
    (c): c is PluginEntry =>
      c != null &&
      typeof c === "object" &&
      typeof (c as { name?: unknown }).name === "string" &&
      typeof (c as { module?: unknown }).module === "string",
  )
}

function reconcile<T>(
  current: Map<string, DocHandle<T>>,
  next: Map<string, DocHandle<T>>,
  onChange: () => void,
): void {
  for (const [key, handle] of current) {
    if (!next.has(key)) handle.off("change", onChange)
  }
  for (const [key, handle] of next) {
    if (!current.has(key)) handle.on("change", onChange)
  }
  current.clear()
  for (const [key, handle] of next) current.set(key, handle)
}

function isFolderDocHandle(handle: DocHandle<unknown>): boolean {
  const doc = handle.doc()
  return (
    typeof doc === "object" &&
    doc !== null &&
    Array.isArray((doc as { docs?: unknown }).docs)
  )
}

function pluginsEqual(a: readonly Plugin[], b: readonly Plugin[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.url !== y.url || x.name !== y.name || x.module !== y.module) {
      return false
    }
  }
  return true
}

function parseJson(content: unknown): unknown {
  if (content == null) return undefined
  try {
    return JSON.parse(contentToText(content as UnixFileEntry["content"]))
  } catch {
    return undefined
  }
}

function contentToText(content: UnixFileEntry["content"]): string {
  if (typeof content === "string") return content
  if (content instanceof Uint8Array) return new TextDecoder().decode(content)
  return String(content)
}

// `automerge:` isn't hierarchical for the URL parser, so swap in `http:`
// to do the path math then swap the scheme back.
function resolveImportUrl(packageJsonUrl: string, importUrl: string): string {
  if (!importUrl.startsWith("./") && !importUrl.startsWith("../")) {
    throw new Error(
      `plugins-provider: contribution "module" must start with "./" or "../" (got "${importUrl}")`,
    )
  }
  const FAKE = "http://overlock.invalid/"
  const base = `${FAKE}${packageJsonUrl.slice("automerge:".length)}`
  const resolved = new URL(importUrl, base).href
  if (!resolved.startsWith(FAKE)) {
    throw new Error(
      `plugins-provider: resolved URL escaped package root: "${importUrl}" from ${packageJsonUrl}`,
    )
  }
  return `automerge:${resolved.slice(FAKE.length)}`
}

// Strip heads so the same doc seen via different snapshots dedups.
function canonicalKey(url: string): string {
  return canonicalUrl(url as AutomergeUrl)
}

function canonicalUrl(url: AutomergeUrl | string): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url as AutomergeUrl)
  return stringifyAutomergeUrl({ documentId })
}
