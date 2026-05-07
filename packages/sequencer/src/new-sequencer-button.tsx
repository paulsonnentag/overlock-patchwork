import { createRoot } from "react-dom/client"

import type { AutomergeUrl } from "@automerge/automerge-repo"

import { withDocHandle } from "patchwork-dom"

import { defaultSequencerDoc } from "./datatype"

type FolderDoc = {
  title: string
  docs: { name: string; type: string; url: AutomergeUrl; icon?: string }[]
}

export default withDocHandle<FolderDoc>(({ element, repo, handle }) => {
  const onClick = () => {
    const seed = defaultSequencerDoc()
    const doc = repo.create({
      "@patchwork": { type: "sequencer" },
      ...seed,
    })
    handle.change((d) => {
      d.docs.push({ name: seed.title, type: "sequencer", url: doc.url })
    })
    element.dispatchEvent(
      new CustomEvent("open-document", {
        bubbles: true,
        detail: { url: doc.url },
      }),
    )
  }

  const root = createRoot(element)
  root.render(
    <button className="new-sequencer-button" onClick={onClick}>
      + sequencer
    </button>,
  )
  return () => root.unmount()
})
