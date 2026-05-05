import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo"

import { defineView, StateHandle } from "patchwork-solid"

import { type FolderDoc, type Manifest } from "./types"

type UnixFileEntry = {
  content: string | Uint8Array | ArrayBuffer | ArrayLike<number>
  [key: string]: unknown
}

const PATCHWORK_CONDITIONS = ["patchwork", "browser", "import"]

export default defineView<FolderDoc>(({ element, repo }) => {
  const root = element.handle
  if (!root) return

  const state = new StateHandle<Manifest[]>([], manifestsEqual)
  Object.assign(element, { value: state })
  element.style.display = "contents"

  const folders = new Map<string, DocHandle<FolderDoc>>()
  const pkgJsons = new Map<string, DocHandle<UnixFileEntry>>()
  const manifestDocs = new Map<string, DocHandle<UnixFileEntry>>()

  let scheduled = false
  let runId = 0

  const onChange = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      void rebuild()
    })
  }

  async function rebuild(): Promise<void> {
    const myRunId = ++runId
    const nextFolders = new Map<string, DocHandle<FolderDoc>>()
    const nextPkgJsons = new Map<string, DocHandle<UnixFileEntry>>()
    const nextManifestDocs = new Map<string, DocHandle<UnixFileEntry>>()
    const nextManifests: Manifest[] = []

    const queue: DocHandle<FolderDoc>[] = [root!]
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
        nextPkgJsons.set(canonicalKey(pkgHandle.url), pkgHandle)

        const pkgJson = parseJson(pkgHandle.doc()?.content)
        if (pkgJson && typeof pkgJson === "object") {
          const exportsField = (pkgJson as { exports?: unknown }).exports
          for (const exportTarget of exportTargets(exportsField)) {
            if (!exportTarget.endsWith(".json")) continue
            const targetParts = splitPath(exportTarget)
            const manifestHandle = await findChild<UnixFileEntry>(
              repo,
              folder,
              targetParts,
            )
            if (!manifestHandle) continue
            if (myRunId !== runId) return
            nextManifestDocs.set(canonicalKey(manifestHandle.url), manifestHandle)

            const raw = parseJson(manifestHandle.doc()?.content)
            if (!isManifestShape(raw)) continue

            const manifestUrl = `${canonicalUrl(folder.url)}/${normalizePath(exportTarget)}`
            nextManifests.push({
              ...raw,
              url: manifestUrl,
              importUrl: resolveImportUrl(manifestUrl, raw.importUrl),
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
    reconcile(manifestDocs, nextManifestDocs, onChange)

    state.change(nextManifests)
  }

  void rebuild()

  return () => {
    runId++
    for (const handle of folders.values()) handle.off("change", onChange)
    for (const handle of pkgJsons.values()) handle.off("change", onChange)
    for (const handle of manifestDocs.values()) handle.off("change", onChange)
    folders.clear()
    pkgJsons.clear()
    manifestDocs.clear()
  }
})

async function findChild<T>(
  repo: Repo,
  folder: DocHandle<FolderDoc>,
  parts: string[],
): Promise<DocHandle<T> | undefined> {
  let cur: DocHandle<unknown> = folder
  for (const part of parts) {
    const doc = (cur as DocHandle<FolderDoc>).doc()
    const link = doc?.docs?.find((d) => d.name === part)
    if (!link) return undefined
    cur = await repo.find(link.url)
  }
  return cur as DocHandle<T>
}

function* exportTargets(value: unknown): Iterable<string> {
  if (value == null) return
  if (typeof value === "string") {
    yield value
    return
  }
  if (typeof value !== "object") return
  for (const v of Object.values(value as Record<string, unknown>)) {
    const target = resolveExportTarget(v, PATCHWORK_CONDITIONS)
    if (target) yield target
  }
}

function resolveExportTarget(
  value: unknown,
  conditions: readonly string[],
): string | undefined {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return undefined
  const obj = value as Record<string, unknown>
  for (const c of conditions) {
    if (c in obj) {
      const sub = resolveExportTarget(obj[c], conditions)
      if (sub) return sub
    }
  }
  if ("default" in obj) return resolveExportTarget(obj.default, conditions)
  return undefined
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

function isManifestShape(
  value: unknown,
): value is Record<string, unknown> & { name: string; importUrl: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { importUrl?: unknown }).importUrl === "string"
  )
}

function isFolderDocHandle(handle: DocHandle<unknown>): boolean {
  const doc = handle.doc()
  return (
    typeof doc === "object" &&
    doc !== null &&
    Array.isArray((doc as { docs?: unknown }).docs)
  )
}

function manifestsEqual(a: readonly Manifest[], b: readonly Manifest[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.url !== y.url || x.name !== y.name || x.importUrl !== y.importUrl) {
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
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(content)
  if (ArrayBuffer.isView(content)) return new TextDecoder().decode(content)
  if (Array.isArray(content)) return new TextDecoder().decode(Uint8Array.from(content))
  return String(content)
}

function resolveImportUrl(manifestUrl: string, importUrl: string): string {
  if (!importUrl.startsWith("./")) {
    throw new Error(
      `package-registry: manifest "importUrl" must start with "./" (got "${importUrl}")`,
    )
  }
  const lastSlash = manifestUrl.lastIndexOf("/")
  if (lastSlash === -1 || lastSlash <= "automerge:".length) {
    throw new Error(
      `package-registry: cannot resolve "${importUrl}" against root URL`,
    )
  }
  return `${manifestUrl.slice(0, lastSlash)}/${importUrl.slice(2)}`
}

function splitPath(p: string): string[] {
  return p
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean)
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/^\/+/, "")
}

// Strip heads so the same doc seen via different snapshots dedups.
function canonicalKey(url: string): string {
  return canonicalUrl(url as AutomergeUrl)
}

function canonicalUrl(url: AutomergeUrl | string): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url as AutomergeUrl)
  return stringifyAutomergeUrl({ documentId })
}
