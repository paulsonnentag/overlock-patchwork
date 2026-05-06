import type { Repo } from "@automerge/automerge-repo"

import {
  toCtx,
  type Ctx,
  type Find,
  type Handler,
  type Mount,
  type RegisterView,
} from "./types"

type Registry = { registerView: RegisterView }

export type WithContextCtx = {
  element: HTMLElement
  repo: Repo
  registerView: RegisterView
  find: Find
}

export function withContext<C extends Ctx>(
  next: Handler<C & WithContextCtx>,
): Mount<C> {
  return (input) => {
    const ctx = toCtx<C>(input)
    const find = makeFind(ctx.element)
    const repoEl = find((el) => isRepoContext((el as ContextEl).value))
    if (!repoEl) throw new Error("withContext: no <repo-context> ancestor")
    const repo = (repoEl as ContextEl).value as Repo
    const registryEl = find((el) =>
      isRegistryContext((el as ContextEl).value),
    )
    if (!registryEl) {
      throw new Error("withContext: no view-registry-context ancestor")
    }
    const registry = (registryEl as ContextEl).value as Registry
    return next({
      ...ctx,
      repo,
      registerView: registry.registerView,
      find,
    })
  }
}

export function isRepoContext(value: unknown): value is Repo {
  return (
    typeof value === "object" &&
    value !== null &&
    "find" in value &&
    typeof (value as { find?: unknown }).find === "function" &&
    "create" in value &&
    typeof (value as { create?: unknown }).create === "function"
  )
}

export function isRegistryContext(value: unknown): value is Registry {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerView" in value &&
    typeof (value as { registerView?: unknown }).registerView === "function"
  )
}

type ContextEl = HTMLElement & { value?: unknown; handle?: unknown }

function makeFind(start: HTMLElement): Find {
  return ((predicate: (el: HTMLElement) => boolean) => {
    let current: HTMLElement | null = start.parentElement
    while (current) {
      if (predicate(current)) return current
      current = current.parentElement
    }
    return undefined
  }) as Find
}
