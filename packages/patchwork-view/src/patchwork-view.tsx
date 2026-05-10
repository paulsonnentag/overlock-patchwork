import { Show, createSignal } from "solid-js"
import { render } from "solid-js/web"

import type { AutomergeUrl } from "@automerge/automerge-repo"
import { useDocument } from "@automerge/automerge-repo-solid-primitives"

import { getRepo, observeAttributes } from "patchwork-dom"

export default (element: HTMLElement) => {
  const repo = getRepo(element)

  const [url, setUrl] = createSignal<string | null>(null)
  const stopObserving = observeAttributes(element, { url: setUrl })
  setUrl(element.getAttribute("url"))

  const dispose = render(() => {
    const [doc] = useDocument(() => url() as AutomergeUrl, { repo })
    return (
      <Show when={doc()} fallback={<EmptyState />}>
        {(d) => (
          <pre class="patchwork-view__json">
            {JSON.stringify(d(), null, 2)}
          </pre>
        )}
      </Show>
    )
  }, element)

  return () => {
    stopObserving()
    dispose()
  }
}

function EmptyState() {
  return (
    <div class="patchwork-view__empty">
      <em>No document.</em>
    </div>
  )
}
