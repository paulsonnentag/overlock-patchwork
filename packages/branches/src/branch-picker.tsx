import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js"
import { render } from "solid-js/web"

import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo"

import { withDocHandle } from "patchwork-dom"
import { useHandle } from "patchwork-solid"

import {
  BRANCH_MARKER,
  isBranchableRepo,
  type BranchIndexDoc,
  type DocWithBranchIndex,
} from "./types"

function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url)
  return stringifyAutomergeUrl({ documentId })
}

export default withDocHandle<DocWithBranchIndex>(({ element, repo, handle }) => {
  if (!isBranchableRepo(repo)) {
    throw new Error("branch-picker: no <checked-out-branch-context> ancestor")
  }
  const branchable = repo
  const rawRepo = branchable.repo
  const originalUrl = handle.url

  const Picker = () => {
    const doc = useHandle(handle)

    const [branchState, setBranchState] = createSignal({
      url: branchable.branchHandle?.url ?? null,
      name: (branchable.branchHandle?.doc() as { name?: string } | undefined)
        ?.name ?? null,
    })

    const refreshBranchState = () => {
      setBranchState({
        url: branchable.branchHandle?.url ?? null,
        name:
          (branchable.branchHandle?.doc() as { name?: string } | undefined)
            ?.name ?? null,
      })
    }

    handle.on("change", refreshBranchState)
    onCleanup(() => handle.off("change", refreshBranchState))

    // Track the branch index doc by url-of-doc. We re-attach to the
    // index handle when its url changes; the version counter bumps on
    // every change of the live index handle so the branches list stays
    // current as new branches are appended.
    let indexHandle: DocHandle<BranchIndexDoc> | null = null
    let cancelled = false
    const [indexVersion, setIndexVersion] = createSignal(0)
    const onIndexChange = () => setIndexVersion((v) => v + 1)

    const attachIndex = async (url: AutomergeUrl | null) => {
      if (indexHandle) indexHandle.off("change", onIndexChange)
      indexHandle = null
      if (!url) {
        onIndexChange()
        return
      }
      const h = await rawRepo.find<BranchIndexDoc>(url)
      if (cancelled) return
      indexHandle = h
      h.on("change", onIndexChange)
      onIndexChange()
    }

    let lastIndexUrl: AutomergeUrl | null = null
    createEffect(() => {
      const url = doc[BRANCH_MARKER]?.branchIndexUrl ?? null
      if (url === lastIndexUrl) return
      lastIndexUrl = url
      void attachIndex(url)
    })

    onCleanup(() => {
      cancelled = true
      if (indexHandle) indexHandle.off("change", onIndexChange)
    })

    const [branches, setBranches] = createSignal<
      Array<{ url: AutomergeUrl; name: string }>
    >([])

    createEffect(() => {
      indexVersion() // re-run on index changes
      const urls = indexHandle?.doc()?.branches ?? []
      let alive = true
      onCleanup(() => {
        alive = false
      })
      Promise.all([...urls].map((u) => rawRepo.find(u))).then((handles) => {
        if (!alive || cancelled) return
        setBranches(
          handles.map((h) => ({
            url: h.url,
            name:
              (h.doc() as { name?: string } | undefined)?.name ?? "Untitled",
          })),
        )
      })
    })

    const branchOptions = () => {
      const list = branches().slice()
      const current = branchState()
      if (current.url && !list.some((b) => b.url === current.url)) {
        list.unshift({ url: current.url, name: current.name ?? "Branch" })
      }
      return list
    }

    const onSelectChange = (event: Event) => {
      const value = (event.currentTarget as HTMLSelectElement).value
      const current = branchState().url
      if (value === "main") {
        if (current) {
          element.dispatchEvent(
            new CustomEvent("branch:reset", { bubbles: true }),
          )
        }
      } else if (value !== current) {
        element.dispatchEvent(
          new CustomEvent("branch:checkout", {
            bubbles: true,
            detail: { url: value as AutomergeUrl },
          }),
        )
      }
    }

    const onCreateBranch = async () => {
      if (branchState().url) return
      const name = window.prompt("Branch name?")
      if (!name) return

      let idx = indexHandle
      if (!idx) {
        idx = rawRepo.create<BranchIndexDoc>({
          [BRANCH_MARKER]: { type: "branch-index" },
          branches: [],
        })
        const original = await rawRepo.find<DocWithBranchIndex>(originalUrl)
        const idxUrl = idx.url
        original.change((d) => {
          if (!d[BRANCH_MARKER]) d[BRANCH_MARKER] = {}
          d[BRANCH_MARKER]!.branchIndexUrl = idxUrl
        })
      }
      const indexRef = idx

      // After the boundary applies the fork, write the new branch doc
      // url into the index. The synthetic change event fired by
      // _rewire arrives after `branchHandle` has been swapped, so it's
      // a reliable trigger for "the fork is done".
      const onceChange = () => {
        const branchUrl = branchable.branchHandle?.url
        if (!branchUrl) return
        indexRef.change((d) => {
          if (!Array.isArray(d.branches)) d.branches = []
          if (!d.branches.includes(branchUrl)) d.branches.push(branchUrl)
        })
      }
      handle.once("change", onceChange)

      element.dispatchEvent(
        new CustomEvent("branch:fork", {
          bubbles: true,
          detail: { urls: [originalUrl], name },
        }),
      )
    }

    const onMerge = async () => {
      const branchHandle = branchable.branchHandle
      if (!branchHandle) return
      const branchDoc = branchHandle.doc() as
        | { clones?: Record<AutomergeUrl, AutomergeUrl> }
        | undefined
      const cloneUrlWithHeads = branchDoc?.clones?.[originalUrl]
      if (!cloneUrlWithHeads) {
        console.warn(
          "branch-picker: branch has no clone for the original doc",
        )
        return
      }
      const cloneHandle = await rawRepo.find(canonicalUrl(cloneUrlWithHeads))
      const original = await rawRepo.find(originalUrl)
      original.merge(cloneHandle)
      element.dispatchEvent(new CustomEvent("branch:reset", { bubbles: true }))
    }

    return (
      <>
        <style>{`
          branch-picker {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font: inherit;
            color: #4b5563;
          }
          branch-picker select {
            font: inherit;
            padding: 0.25rem 0.4rem;
            border: 1px solid #d4d4d4;
            border-radius: 4px;
            background: #fff;
            color: inherit;
          }
          branch-picker button {
            font: inherit;
            padding: 0.25rem 0.6rem;
            border: 1px solid #d4d4d4;
            border-radius: 4px;
            background: #fff;
            color: inherit;
            cursor: pointer;
          }
          branch-picker button:hover {
            background: #f3f4f6;
          }
        `}</style>
        <select value={branchState().url ?? "main"} onChange={onSelectChange}>
          <option value="main">main</option>
          <For each={branchOptions()}>
            {(b) => <option value={b.url}>{b.name}</option>}
          </For>
        </select>
        <Show when={!branchState().url}>
          <button type="button" onClick={onCreateBranch}>
            + branch
          </button>
        </Show>
        <Show when={branchState().url}>
          <button type="button" onClick={onMerge}>
            merge into main
          </button>
        </Show>
      </>
    )
  }

  return render(() => <Picker />, element)
})
