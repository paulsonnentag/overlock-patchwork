import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

export default function (element) {
  const handle = element.handle;

  function Editor() {
    const styles = html`
      <style>
        markdown-editor { display: flex; flex: 1 1 auto; min-height: 0; }
        markdown-editor textarea {
          flex: 1 1 auto;
          width: 100%;
          padding: 1rem 1.25rem;
          margin: 0;
          font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: inherit;
          background: transparent;
          border: 0;
          resize: none;
          outline: none;
        }
        markdown-editor textarea:disabled { color: #9ca3af; }
      </style>
    `;

    if (!handle) {
      return html`
        ${styles}
        <textarea disabled placeholder="Select a document"></textarea>
      `;
    }

    const doc = makeDocumentProjection(handle);
    const onInput = (event) => {
      const next = event.currentTarget.value;
      handle.change((d) => {
        d.content = next;
      });
    };
    return html`
      ${styles}
      <textarea
        spellcheck="false"
        placeholder="Write some markdown…"
        value=${() => doc.content ?? ""}
        onInput=${onInput}
      ></textarea>
    `;
  }

  return render(() => Editor(), element);
}
