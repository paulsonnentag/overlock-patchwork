import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";

export default function (element) {
  const repo = element.repo;
  // The button sits as a direct child of `<root-folder-context>`, which
  // propagates the folder URL via `doc=`, so `el.handle` resolves to
  // the folder doc by the time we mount. No upward schema lookup
  // needed.
  const folderHandle = element.handle;

  function Button() {
    const disabled = () => !repo || !folderHandle;

    const onClick = () => {
      if (!repo || !folderHandle) return;
      const newDoc = repo.create(newMarkdown());
      folderHandle.change((d) => {
        if (!Array.isArray(d.docs)) d.docs = [];
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

function newMarkdown() {
  return {
    "@patchwork": { type: "markdown" },
    title: "Untitled",
    content: "",
  };
}
