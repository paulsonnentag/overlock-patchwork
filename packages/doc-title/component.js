import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

export default function (element) {
  const handle = element.handle;

  function Title() {
    const styles = html`
      <style>
        doc-title { display: block; }
        doc-title input {
          display: block;
          width: 100%;
          padding: 0.25rem 0;
          font: 600 1.15rem/1.3 inherit;
          background: transparent;
          border: 0;
          color: inherit;
        }
        doc-title input:focus { outline: 2px solid #93c5fd; outline-offset: 2px; }
        doc-title .placeholder {
          padding: 0.25rem 0;
          color: #9ca3af;
          font: 600 1.15rem/1.3 inherit;
        }
      </style>
    `;

    if (!handle) {
      return html`${styles}<div class="placeholder">No document selected</div>`;
    }

    const doc = makeDocumentProjection(handle);
    const onInput = (event) => {
      const next = event.currentTarget.value;
      handle.change((d) => {
        d.title = next;
      });
    };
    return html`
      ${styles}
      <input
        type="text"
        placeholder="Untitled"
        value=${() => doc.title ?? ""}
        onInput=${onInput}
      />
    `;
  }

  return render(() => Title(), element);
}
