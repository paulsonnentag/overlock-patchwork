import { useSyncExternalStore } from "react"

import type { Doc, DocHandle } from "@automerge/automerge-repo"
import { StateHandle } from "patchwork-dom"

export function useHandle<T>(handle: StateHandle<T>): T
export function useHandle<T extends object>(handle: DocHandle<T>): Doc<T>
export function useHandle(
  handle: StateHandle<unknown> | DocHandle<object>,
): unknown {
  if (handle instanceof StateHandle) {
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
