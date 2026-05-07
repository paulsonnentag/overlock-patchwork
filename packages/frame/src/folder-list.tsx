import { For } from "solid-js"
import { render } from "solid-js/web"

import { withDocHandle } from "patchwork-dom"
import { useHandle } from "patchwork-solid"
import type { FolderDoc } from "patchwork-schemas"

export default withDocHandle<FolderDoc>(({ element, handle }) => {
  const folder = useHandle(handle)

  return render(
    () => (
      <ul class="folder-list">
        <For each={folder.docs}>
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
