import { createSignal, onCleanup } from "solid-js"

import type { Doc, DocHandle } from "@automerge/automerge-repo"
import { makeDocumentProjection } from "@automerge/automerge-repo-solid-primitives"
import { StateHandle } from "patchwork-dom"

export function useHandle<T>(handle: StateHandle<T>): () => T
export function useHandle<T extends object>(handle: DocHandle<T>): Doc<T>
export function useHandle(
  handle: StateHandle<unknown> | DocHandle<object>,
): (() => unknown) | Doc<object> {
  if (handle instanceof StateHandle) {
    const [value, setValue] = createSignal(handle.value)
    const onChange = () => setValue(() => handle.value)
    handle.addEventListener("change", onChange)
    onCleanup(() => handle.removeEventListener("change", onChange))
    return value
  }
  return makeDocumentProjection(handle)
}
