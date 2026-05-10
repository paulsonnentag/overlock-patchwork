import {
  type AutomergeUrl,
  type DocHandle,
  type Repo,
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

export type PluginManifest = { name: string } & Record<string, unknown>

export type Plugins = {
  plugins: Record<string, PluginManifest>
}

export function hasPluginsProvider(
  el: HTMLElement,
): el is ElementWithHandle<StateHandle<Plugins>> {
  const handle = readHandle(el)
  if (!isStateHandle(handle)) return false
  const v = handle.value as Partial<Plugins> | null
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.plugins === "object" &&
    v.plugins !== null
  )
}

export default (element: HTMLElement) => {
  const repo = getRepo(element)
  const state = new StateHandle<Plugins>({ plugins: {} })
  Object.assign(element, { handle: state })
  element.style.display = "contents"

  const perPackage = new Map<AutomergeUrl, PackageWatch>()
  let stopRoot: (() => void) | undefined
  let runId = 0

  const publish = () => {
    const merged: Record<string, PluginManifest> = {}
    for (const watch of perPackage.values()) {
      Object.assign(merged, watch.manifests)
    }
    state.change({ plugins: merged })
  }

  const teardown = () => {
    stopRoot?.()
    stopRoot = undefined
    for (const w of perPackage.values()) w.stop()
    perPackage.clear()
  }

  const onUrl = async (raw: string | null) => {
    const myRun = ++runId
    teardown()
    if (!raw) {
      state.change({ plugins: {} })
      return
    }

    const root = await repo.find<FolderDoc>(raw as AutomergeUrl)
    if (myRun !== runId) return

    const reconcile = () => {
      const desired = new Set<AutomergeUrl>()
      for (const link of root.doc()?.docs ?? []) {
        if (link.type === "folder") desired.add(link.url)
      }
      for (const [url, watch] of perPackage) {
        if (!desired.has(url)) {
          watch.stop()
          perPackage.delete(url)
        }
      }
      for (const url of desired) {
        if (perPackage.has(url)) continue
        perPackage.set(url, watchPackage(repo, url, publish))
      }
      publish()
    }

    root.on("change", reconcile)
    stopRoot = () => root.off("change", reconcile)
    reconcile()
  }

  const stopObserving = observeAttributes(element, {
    url: (value) => void onUrl(value),
  })
  void onUrl(element.getAttribute("url"))

  return () => {
    runId++
    teardown()
    stopObserving()
  }
}

type PackageWatch = {
  stop: () => void
  manifests: Record<string, PluginManifest>
}

type HandleSub<T> = {
  url: AutomergeUrl
  handle: DocHandle<T>
  onChange: () => void
}

// Watches a single package folder. Maintains three layers of
// subscriptions, all reconciled on every change tick:
//   - the folder doc itself (membership of package.json + manifests)
//   - the package.json doc (its content drives `exports`)
//   - each exported `.json` file (manifest contents)
// Any of those can be edited in place (same url, new content) or
// replaced wholesale (link's url changes / link disappears); the
// reconcile pass detaches the stale listener and attaches a fresh one.
function watchPackage(
  repo: Repo,
  pkgUrl: AutomergeUrl,
  publish: () => void,
): PackageWatch {
  const watch: PackageWatch = { stop: () => {}, manifests: {} }
  let cancelled = false

  let folder: DocHandle<FolderDoc> | undefined
  let onFolderChange: (() => void) | undefined

  let pkgJsonSub: HandleSub<UnixFileEntry> | undefined
  // resolved file path (e.g. "dist/foo-component.json") -> subscription
  const manifestSubs = new Map<string, HandleSub<UnixFileEntry>>()

  // Recomputes can overlap (each await yields, and any subscribed
  // change can re-enter via `void recompute()`). A generation counter
  // lets every async stretch bail if it's been superseded so we don't
  // publish stale manifests or attach listeners that the latest pass
  // has already chosen to detach.
  let recomputeId = 0

  const linkUrl = (name: string): AutomergeUrl | undefined =>
    folder?.doc()?.docs?.find((d) => d.name === name)?.url

  const onChildChange = () => {
    void recompute()
  }

  const recompute = async (): Promise<void> => {
    if (cancelled || !folder) return
    const myId = ++recomputeId

    pkgJsonSub = await reconcileSub(pkgJsonSub, linkUrl("package.json"))
    if (cancelled || myId !== recomputeId) return

    const pkgJson = parseJson(pkgJsonSub?.handle.doc()?.content)
    const wantedTargets = collectJsonExportTargets(pkgJson?.exports)

    for (const path of [...manifestSubs.keys()]) {
      if (!wantedTargets.has(path)) {
        detachSub(manifestSubs.get(path))
        manifestSubs.delete(path)
      }
    }

    const nextManifests: Record<string, PluginManifest> = {}
    for (const path of wantedTargets) {
      const fileHandle = await resolveFileHandle(repo, folder, path)
      if (cancelled || myId !== recomputeId) return

      const next = await reconcileSub(
        manifestSubs.get(path),
        fileHandle?.url,
        fileHandle,
      )
      if (cancelled || myId !== recomputeId) return
      if (next) manifestSubs.set(path, next)
      else manifestSubs.delete(path)

      const parsed = parseJson(next?.handle.doc()?.content)
      if (parsed && typeof parsed.name === "string") {
        nextManifests[`${pkgUrl}/${path}`] = parsed as PluginManifest
      }
    }

    if (cancelled || myId !== recomputeId) return
    watch.manifests = nextManifests
    publish()
  }

  // Attach/detach a single handle subscription, returning the live sub
  // if one should be in place. Pass `prefetched` when the caller has
  // already resolved the handle to avoid a redundant repo.find().
  const reconcileSub = async <T>(
    current: HandleSub<T> | undefined,
    wantedUrl: AutomergeUrl | undefined,
    prefetched?: DocHandle<T>,
  ): Promise<HandleSub<T> | undefined> => {
    if (current?.url === wantedUrl) return current
    detachSub(current)
    if (!wantedUrl) return undefined
    const handle = prefetched ?? (await repo.find<T>(wantedUrl))
    if (cancelled) return undefined
    handle.on("change", onChildChange)
    return { url: wantedUrl, handle, onChange: onChildChange }
  }

  void (async () => {
    folder = await repo.find<FolderDoc>(pkgUrl)
    if (cancelled) return
    onFolderChange = () => void recompute()
    folder.on("change", onFolderChange)
    void recompute()
  })()

  watch.stop = () => {
    cancelled = true
    if (folder && onFolderChange) folder.off("change", onFolderChange)
    detachSub(pkgJsonSub)
    pkgJsonSub = undefined
    for (const sub of manifestSubs.values()) detachSub(sub)
    manifestSubs.clear()
  }

  return watch
}

function detachSub<T>(sub: HandleSub<T> | undefined): void {
  if (!sub) return
  sub.handle.off("change", sub.onChange)
}

// Inlined path-walk through a FolderDoc tree. We avoid pulling
// `findHandleInFolderHandle` from `@inkandswitch/patchwork-filesystem`
// at runtime because that module pulls in the automerge-subduction wasm
// and breaks the vite build; type-only imports are fine.
async function resolveFileHandle(
  repo: Repo,
  folder: DocHandle<FolderDoc>,
  path: string,
): Promise<DocHandle<UnixFileEntry> | undefined> {
  const parts = path.split("/").filter(Boolean)
  if (parts.length === 0) return undefined

  let current: DocHandle<FolderDoc> = folder
  for (let i = 0; i < parts.length - 1; i++) {
    const link = current.doc()?.docs?.find((d) => d.name === parts[i])
    if (!link) return undefined
    current = await repo.find<FolderDoc>(link.url)
  }

  const leafLink = current.doc()?.docs?.find(
    (d) => d.name === parts[parts.length - 1],
  )
  if (!leafLink) return undefined
  const handle = await repo.find<UnixFileEntry>(leafLink.url)
  // Don't treat a folder hit as a file. The doc-shape check is the
  // only signal we have since DocLink.type isn't reliably set.
  const doc = handle.doc() as Partial<UnixFileEntry & FolderDoc> | undefined
  if (!doc || "docs" in doc) return undefined
  return handle
}

function parseJson(
  content: UnixFileEntry["content"] | undefined,
): Record<string, unknown> | undefined {
  if (content == null) return undefined
  let text: string
  if (typeof content === "string") {
    text = content
  } else if (content instanceof Uint8Array) {
    text = new TextDecoder().decode(content)
  } else if (
    typeof (content as { toString?: () => string }).toString === "function"
  ) {
    text = (content as { toString(): string }).toString()
  } else {
    return undefined
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" ? parsed : undefined
  } catch {
    return undefined
  }
}

// Walks the (possibly-nested) `exports` value and returns every string
// leaf that points at a `.json` file, normalized to a folder-relative
// path with no leading "./". Pattern exports (containing "*") are
// skipped — manifests aren't templated.
function collectJsonExportTargets(exports: unknown): Set<string> {
  const out = new Set<string>()
  for (const target of walkStringLeaves(exports)) {
    if (!target.endsWith(".json")) continue
    if (target.includes("*")) continue
    out.add(target.replace(/^\.\//, ""))
  }
  return out
}

function* walkStringLeaves(node: unknown): Generator<string> {
  if (typeof node === "string") {
    yield node
  } else if (Array.isArray(node)) {
    for (const item of node) yield* walkStringLeaves(item)
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) yield* walkStringLeaves(v)
  }
}
