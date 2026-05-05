import { Show } from "solid-js"
import { render } from "solid-js/web"

import {
  defineView,
  findContext,
  makeStateProjection,
} from "patchwork-solid"

import { isDocumentSelectionHandle } from "./types"

const MARKDOWN_EDITOR_SRC =
  "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/dist/markdown-editor.json"

export default defineView(({ element, registerView }) => {
  const sel = findContext(element, isDocumentSelectionHandle)
  if (!sel) throw new Error("single-view: no document-selection-context")

  const MarkdownEditor = registerView(MARKDOWN_EDITOR_SRC)
  const state = makeStateProjection(sel)

  return render(
    () => (
      <Show when={state().activeDocumentUrl}>
        {(url) => <MarkdownEditor url={url()} />}
      </Show>
    ),
    element,
  )
})
