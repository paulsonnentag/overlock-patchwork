import type { AutomergeUrl } from "@automerge/automerge-repo"

import type { BranchableRepo } from "./branchable-repo"

export const BRANCH_MARKER = "@patchwork" as const
export const BRANCH_TYPE = "branch" as const

export type BranchDoc = {
  [BRANCH_MARKER]: { type: typeof BRANCH_TYPE }
  name?: string
  createdAt?: number
  clones: Record<AutomergeUrl, AutomergeUrl>
}

export type BranchIndexDoc = {
  [BRANCH_MARKER]: { type: "branch-index" }
  branches: AutomergeUrl[]
}

export type ForkOpts = {
  urls?: AutomergeUrl[]
  name?: string
}

export type DocWithBranchIndex = {
  [BRANCH_MARKER]?: { branchIndexUrl?: AutomergeUrl }
}

export function isBranchableRepo(value: unknown): value is BranchableRepo {
  // Avoid `instanceof` to keep the guard cheap and resilient across
  // module re-instantiation (HMR, multiple bundles).
  return (
    !!value &&
    typeof value === "object" &&
    "branchHandle" in value &&
    typeof (value as { fork?: unknown }).fork === "function" &&
    typeof (value as { checkout?: unknown }).checkout === "function" &&
    typeof (value as { reset?: unknown }).reset === "function"
  )
}
