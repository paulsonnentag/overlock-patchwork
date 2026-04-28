import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
// ─── Sibling library URL ────────────────────────────────────────────────
//
// After `pnpm push packages` runs, copy `rootDirectoryUrl` from
// `packages/solid-helpers/.pushwork/snapshot.json` and paste it in
// place of the placeholder below, then re-run `pnpm push packages`.
// The URL stays stable across subsequent pushes.
import { fromHandle } from "automerge:2aqfwfd7XjcbAHBGFB27WqGnoWB7/solid-helpers.js";

const folderSchema = {
  init: () => ({ "@patchwork": { type: "folder" }, title: "", docs: [] }),
  parse: (value) => {
    if (!value || typeof value !== "object") {
      throw new Error("new-markdown-button: not a folder doc");
    }
    if (value["@patchwork"]?.type !== "folder") {
      throw new Error("new-markdown-button: doc is not type=folder");
    }
    if (!Array.isArray(value.docs)) {
      throw new Error("new-markdown-button: folder.docs is not an array");
    }
    return value;
  },
};

function newMarkdown() {
  return {
    "@patchwork": { type: "markdown" },
    title: "Untitled",
    content: "",
  };
}

export default function (element) {
  const repo = element.repo;
  const folder$ = element.closestView(folderSchema);

  function Button() {
    const folder = fromHandle(folder$);
    const disabled = () => !repo || !folder();

    const onClick = () => {
      const f = folder();
      if (!repo || !f) return;
      const newDoc = repo.create(newMarkdown());
      f.handle.change((d) => {
        d.docs.push({
          name: "Untitled",
          type: "markdown",
          url: newDoc.url,
        });
      });
      element.dispatchEvent(
        new CustomEvent("patchwork:open-document", {
          detail: { url: newDoc.url },
          bubbles: true,
          composed: true,
        }),
      );
    };

    return html`
      <style>
        new-markdown-button {
          display: block;
          padding: 0.5rem;
        }
        new-markdown-button > button {
          width: 100%;
          padding: 0.5rem 0.75rem;
          font: inherit;
          color: #fff;
          background: #2563eb;
          border: 0;
          border-radius: 6px;
          cursor: pointer;
        }
        new-markdown-button > button:disabled {
          background: #9ca3af;
          cursor: default;
        }
        new-markdown-button > button:hover:not(:disabled) {
          background: #1d4ed8;
        }
      </style>
      <button type="button" onClick=${onClick} disabled=${disabled}>
        + new markdown
      </button>
    `;
  }

  return render(() => Button(), element);
}
