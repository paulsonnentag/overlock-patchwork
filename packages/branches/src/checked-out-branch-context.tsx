import type { AutomergeUrl, Repo } from "@automerge/automerge-repo"

import { findContext, type ViewElement } from "patchwork-solid"

import { BranchableRepo } from "./branchable-repo"
import { isBranchableRepo, type ForkOpts } from "./types"

function isRepoLike(value: unknown): value is Repo {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { find?: unknown }).find === "function" &&
    typeof (value as { create?: unknown }).create === "function"
  )
}

export default (element: ViewElement) => {
  const outer = findContext(element, isRepoLike)
  if (!outer) {
    throw new Error(
      "checked-out-branch-context: no <repo-context> ancestor",
    )
  }
  if (isBranchableRepo(outer)) {
    throw new Error(
      "checked-out-branch-context: nested branching is not supported",
    )
  }

  const branchable = new BranchableRepo(outer)

  const inner = document.createElement("repo-context")
  Object.assign(inner, { value: branchable })
  inner.style.display = "contents"
  while (element.firstChild) inner.appendChild(element.firstChild)
  element.appendChild(inner)

  const onFork = (e: Event) => {
    const detail = (e as CustomEvent<ForkOpts | undefined>).detail
    void branchable.fork(detail ?? {})
  }
  const onCheckout = (e: Event) => {
    const detail = (e as CustomEvent<{ url: AutomergeUrl }>).detail
    if (!detail?.url) return
    void branchable.checkout(detail.url)
  }
  const onReset = () => branchable.reset()

  element.addEventListener("branch:fork", onFork)
  element.addEventListener("branch:checkout", onCheckout)
  element.addEventListener("branch:reset", onReset)

  return () => {
    element.removeEventListener("branch:fork", onFork)
    element.removeEventListener("branch:checkout", onCheckout)
    element.removeEventListener("branch:reset", onReset)
  }
}
