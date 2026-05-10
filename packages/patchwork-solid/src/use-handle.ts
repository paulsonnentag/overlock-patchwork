import { createSignal, onCleanup } from "solid-js";

import type { Doc, DocHandle } from "@automerge/automerge-repo";
import { makeDocumentProjection } from "@automerge/automerge-repo-solid-primitives";
import { isStateHandle, type StateHandleLike } from "patchwork-dom";

export function useHandle<T>(handle: StateHandleLike<T>): () => T;
export function useHandle<T extends object>(handle: DocHandle<T>): Doc<T>;
export function useHandle(
  handle: StateHandleLike<unknown> | DocHandle<object>
): (() => unknown) | Doc<object> {
  if (isStateHandle(handle)) {
    const [value, setValue] = createSignal(handle.value);
    const onChange = () => setValue(() => handle.value);
    handle.addEventListener("change", onChange);
    onCleanup(() => handle.removeEventListener("change", onChange));
    return value;
  }
  return makeDocumentProjection(handle);
}
