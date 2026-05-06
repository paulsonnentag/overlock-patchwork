import { Show } from "solid-js"
import { render } from "solid-js/web"

import type { StateHandle } from "patchwork-dom"
import { useHandle, withSolid } from "patchwork-solid"

import { isDocumentSelectionHandle, type DocumentSelection } from "./types"

const MARKDOWN_EDITOR_SRC =
  "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/dist/markdown-editor.json"

export default withSolid(({ element, registerView, find }) => {
  const selectionEl = find((el) =>
    isDocumentSelectionHandle((el as HTMLElement & { handle?: unknown }).handle),
  )
  if (!selectionEl) throw new Error("single-view: no selection ancestor")
  const sel = (selectionEl as HTMLElement & { handle: StateHandle<DocumentSelection> })
    .handle

  const MarkdownEditor = registerView(MARKDOWN_EDITOR_SRC)
  const state = useHandle(sel)

  return render(
    () => (
      <Show when={state().activeDocumentUrl}>
        {(url) => <MarkdownEditor url={url()} />}
      </Show>
    ),
    element,
  )
})
