import { Show } from "solid-js"
import { render } from "solid-js/web"

import { findHandle } from "patchwork-dom"
import { registerComponent, useHandle } from "patchwork-solid"

import { hasDocumentSelection } from "./types"

const MARKDOWN_EDITOR_URL =
  "automerge:MgZABPTTW3m3xzAyBhEX4SMJ5ao/dist/package.json#components/markdown-editor"

export default (element: HTMLElement) => {
  const sel = findHandle(element, hasDocumentSelection)
  if (!sel) throw new Error("single-view: no selection ancestor")

  const MarkdownEditor = registerComponent(element, MARKDOWN_EDITOR_URL)
  const state = useHandle(sel)

  return render(
    () => (
      <Show when={state().activeDocumentUrl}>
        {(url) => <MarkdownEditor url={url()} />}
      </Show>
    ),
    element,
  )
}
