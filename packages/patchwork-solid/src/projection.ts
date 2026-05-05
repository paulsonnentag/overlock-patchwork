import { createSignal, onCleanup } from "solid-js"

import type { DocHandle, Doc } from "@automerge/automerge-repo"
import { StateHandle } from "patchwork-view"

export function makeDocumentProjection<T>(handle: DocHandle<T>): () => Doc<T> {
  const [doc, setDoc] = createSignal(handle.doc())
  const onChange = () => setDoc(() => handle.doc())
  handle.on("change", onChange)
  handle.on("heads-changed", onChange)
  onCleanup(() => {
    handle.off("change", onChange)
    handle.off("heads-changed", onChange)
  })
  return doc
}

export function makeStateProjection<T>(handle: StateHandle<T>): () => T {
  const [value, setValue] = createSignal(handle.value)
  const onChange = () => setValue(() => handle.value)
  handle.addEventListener("change", onChange)
  onCleanup(() => handle.removeEventListener("change", onChange))
  return value
}
