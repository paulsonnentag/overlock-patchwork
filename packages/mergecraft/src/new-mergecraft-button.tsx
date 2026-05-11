import { createRoot } from "react-dom/client";

import { withDocHandle } from "patchwork-dom";
import type { FolderDoc } from "patchwork-schemas";

import { defaultMergecraftDoc } from "./datatype";

export default withDocHandle<FolderDoc>(({ element, repo, handle }) => {
  const onClick = () => {
    const seed = defaultMergecraftDoc();
    const doc = repo.create({
      "@patchwork": { type: "mergecraft" },
      ...seed,
    });
    handle.change((d) => {
      d.docs.push({ name: seed.title, type: "mergecraft", url: doc.url });
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
    <button className="new-mergecraft-button" onClick={onClick}>
      + mergecraft
    </button>
  );
  return () => root.unmount();
});
