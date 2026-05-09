import { useSyncExternalStore } from "react"

import type { Doc, DocHandle } from "@automerge/automerge-repo"
import { isStateHandle, type StateHandleLike } from "patchwork-dom"

export function useHandle<T>(handle: StateHandleLike<T>): T
export function useHandle<T extends object>(handle: DocHandle<T>): Doc<T>
export function useHandle(
  handle: StateHandleLike<unknown> | DocHandle<object>,
): unknown {
  if (isStateHandle(handle)) {
    return useSyncExternalStore(
      (cb) => {
        handle.addEventListener("change", cb)
        return () => handle.removeEventListener("change", cb)
      },
      () => handle.value,
    )
  }
  return useSyncExternalStore(
    (cb) => {
      handle.on("change", cb)
      return () => handle.off("change", cb)
    },
    () => handle.doc(),
  )
}
