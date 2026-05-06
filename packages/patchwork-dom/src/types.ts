import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo"

export type Cleanup = void | (() => void)
export type MountResult = Cleanup | Promise<Cleanup>

export type Ctx = { element: HTMLElement }

export type Handler<C extends Ctx = Ctx> = (ctx: C) => MountResult

export type Mount<C extends Ctx = Ctx> = (
  input: HTMLElement | C,
) => MountResult

export type ViewElement<V = unknown> = HTMLElement & {
  url: AutomergeUrl | null
  handle: DocHandle<V> | undefined
}

export type RegisterView = (manifestUrl: string) => Promise<string>

export type Find = {
  <T extends HTMLElement>(
    predicate: (element: HTMLElement) => element is T,
  ): T | undefined
  (predicate: (element: HTMLElement) => boolean): HTMLElement | undefined
}

export function toCtx<C extends Ctx>(input: HTMLElement | C): C {
  return input instanceof HTMLElement ? ({ element: input } as C) : input
}
