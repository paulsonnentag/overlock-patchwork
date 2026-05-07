import { render } from "solid-js/web"

import { withDocHandle } from "patchwork-dom"
import type { FolderDoc } from "patchwork-schemas"

export default withDocHandle<FolderDoc>(({ element, repo, handle }) => {
  const onClick = () => {
    const doc = repo.create({
      "@patchwork": { type: "markdown" },
      title: "Untitled",
      content: "# Untitled",
    })
    handle.change((d) => {
      d.docs.push({ name: "Untitled", type: "markdown", url: doc.url })
    })
    element.dispatchEvent(
      new CustomEvent("open-document", {
        bubbles: true,
        detail: { url: doc.url },
      }),
    )
  }

  return render(
    () => (
      <button class="new-markdown-button" onClick={onClick}>
        + markdown
      </button>
    ),
    element,
  )
})
