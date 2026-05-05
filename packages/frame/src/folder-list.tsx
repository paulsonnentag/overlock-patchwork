import { For } from "solid-js"
import { render } from "solid-js/web"

import { defineView, makeDocumentProjection } from "patchwork-solid"

import type { FolderDoc } from "./types"

export default defineView<FolderDoc>(({ element }) => {
  const handle = element.handle
  if (!handle) return

  const folder = makeDocumentProjection(handle)

  return render(
    () => (
      <ul class="folder-list">
        <For each={folder().docs}>
          {(link) => (
            <li
              class="folder-list__item"
              onClick={() =>
                element.dispatchEvent(
                  new CustomEvent("open-document", {
                    bubbles: true,
                    detail: { url: link.url },
                  }),
                )
              }
            >
              {link.name}
            </li>
          )}
        </For>
      </ul>
    ),
    element,
  )
})
