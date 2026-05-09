import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo"

import {
  getRepo,
  isStateHandle,
  observeAttributes,
  readHandle,
  StateHandle,
  type ElementWithHandle,
} from "patchwork-dom"

import type {
  FolderDoc,
  UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem"

export type Plugins = Map<string, Record<string, unknown>>

export function hasPluginsProvider(
  el: HTMLElement,
): el is ElementWithHandle<StateHandle<Plugins>> {
  const handle = readHandle(el)
  if (!isStateHandle(handle)) return false
  return handle.value instanceof Map
}

export default (element: HTMLElement) => {
  const repo = getRepo(element)
  const state = new StateHandle<Plugins>(new Map(), pluginsEqual)
  Object.assign(element, { handle: state })
  element.style.display = "contents"

  const folders = new Map<string, DocHandle<FolderDoc>>()
  const pkgJsons = new Map<string, DocHandle<UnixFileEntry>>()
  const manifestFiles = new Map<string, DocHandle<UnixFileEntry>>()

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
    const nextManifestFiles = new Map<string, DocHandle<UnixFileEntry>>()
    const nextPlugins: Plugins = new Map()

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
        const manifestPaths = readManifestPaths(pkgJson)
        if (manifestPaths.length > 0) {
          const packageJsonUrl = `${canonicalUrl(folder.url)}/package.json`
          for (const rel of manifestPaths) {
            const manifestUrl = resolveImportUrl(packageJsonUrl, rel)
            const manifestDocId = parseAutomergeUrl(
              manifestUrl as AutomergeUrl,
            ).documentId
            const manifestDocUrl = stringifyAutomergeUrl({
              documentId: manifestDocId,
            })
            const manifestHandle = (await repo.find(
              manifestDocUrl,
            )) as DocHandle<UnixFileEntry>
            if (myRunId !== runId) return
            nextManifestFiles.set(canonicalKey(manifestHandle.url), manifestHandle)

            const manifest = parseJson(manifestHandle.doc()?.content)
            if (!isValidManifest(manifest)) {
              console.warn(
                `[plugins-provider] manifest at ${manifestUrl} is missing a "name: string"`,
              )
              continue
            }
            nextPlugins.set(manifestUrl, manifest)
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
    reconcile(manifestFiles, nextManifestFiles, onChange)

    state.change(nextPlugins)
  }

  const onUrl = async (raw: string | null) => {
    runId++
    for (const handle of folders.values()) handle.off("change", onChange)
    for (const handle of pkgJsons.values()) handle.off("change", onChange)
    for (const handle of manifestFiles.values()) handle.off("change", onChange)
    folders.clear()
    pkgJsons.clear()
    manifestFiles.clear()

    if (!raw) {
      rootHandle = undefined
      state.change(new Map())
      return
    }
    const next = await repo.find<FolderDoc>(raw as AutomergeUrl)
    if (cancelled) return
    rootHandle = next
    void rebuild()
  }

  // Install the property↔attribute bridge before the initial read so a
  // pending `el.url = ...` assignment from the framework lands as an
  // attribute first.
  const stopObserving = observeAttributes(element, {
    url: (value) => {
      void onUrl(value)
    },
  })
  void onUrl(element.getAttribute("url"))

  return () => {
    cancelled = true
    runId++
    stopObserving()
    for (const handle of folders.values()) handle.off("change", onChange)
    for (const handle of pkgJsons.values()) handle.off("change", onChange)
    for (const handle of manifestFiles.values()) handle.off("change", onChange)
    folders.clear()
    pkgJsons.clear()
    manifestFiles.clear()
  }
}

function readManifestPaths(pkgJson: unknown): string[] {
  if (pkgJson == null || typeof pkgJson !== "object") return []
  const plugins = (pkgJson as { plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return []
  return plugins.filter((p): p is string => typeof p === "string")
}

function isValidManifest(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string"
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

function pluginsEqual(a: Plugins, b: Plugins): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    if (!b.has(key)) return false
    if (!Object.is(b.get(key), value)) return false
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
      `plugins-provider: manifest path must start with "./" or "../" (got "${importUrl}")`,
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

function canonicalKey(url: string): string {
  return canonicalUrl(url as AutomergeUrl)
}

function canonicalUrl(url: AutomergeUrl | string): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url as AutomergeUrl)
  return stringifyAutomergeUrl({ documentId })
}
