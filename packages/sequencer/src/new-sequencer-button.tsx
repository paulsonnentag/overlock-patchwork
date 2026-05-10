import { createRoot } from "react-dom/client";

import { withDocHandle } from "patchwork-dom";
import type { FolderDoc } from "patchwork-schemas";

import { defaultSequencerDoc } from "./datatype";

export default withDocHandle<FolderDoc>(({ element, repo, handle }) => {
  const onClick = () => {
    const seed = defaultSequencerDoc();
    const doc = repo.create({
      "@patchwork": { type: "sequencer" },
      ...seed,
    });
    handle.change((d) => {
      d.docs.push({ name: seed.title, type: "sequencer", url: doc.url });
    });
    element.dispatchEvent(
      new CustomEvent("open-document", {
        bubbles: true,
        detail: { url: doc.url },
      })
    );
  };

  const root = createRoot(element);
  root.render(
    <button className="new-sequencer-button" onClick={onClick}>
      + sequencer
    </button>
  );
  return () => root.unmount();
});
