import { createRoot } from "react-dom/client";

import { withDocHandle } from "patchwork-dom";
import type { FolderDoc } from "patchwork-schemas";

import { defaultTldrawDoc } from "./datatype";

// Bump on every change so the console shows which build is live.
const BUILD = 5;

console.log(`[new-tldraw-button] loaded build ${BUILD}`);

export default withDocHandle<FolderDoc>(({ element, repo, handle }) => {
  const onClick = () => {
    const seed = defaultTldrawDoc();
    const doc = repo.create({
      "@patchwork": { type: "tldraw" },
      ...seed,
    });
    handle.change((d) => {
      d.docs.push({ name: "New tldraw", type: "tldraw", url: doc.url });
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
    <button className="new-tldraw-button" onClick={onClick}>
      + tldraw
    </button>
  );
  return () => root.unmount();
});
