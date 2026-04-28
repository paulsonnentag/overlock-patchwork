import { For } from "https://esm.sh/solid-js@1.9.5";
import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

const accountSchema = {
  init: () => ({ "@patchwork": { type: "account" } }),
  parse: (value) => {
    if (!value || typeof value !== "object") {
      throw new Error("folder-list: not an account doc");
    }
    if (value["@patchwork"]?.type !== "account") {
      throw new Error("folder-list: doc is not type=account");
    }
    return value;
  },
};

export default function (element) {
  const handle = element.handle;
  const account = element.closestView(accountSchema).value();

  function Empty() {
    return html`
      <style>
        folder-list { display: block; padding: 0 0.5rem; color: #6b7280; font-size: 0.85rem; }
      </style>
      <p>No folder context</p>
    `;
  }

  function List() {
    const doc = makeDocumentProjection(handle);
    const accountDoc = account ? makeDocumentProjection(account.handle) : null;
    const isSelected = (url) => accountDoc?.selectedDocUrl === url;
    const onOpen = (url) => {
      element.dispatchEvent(
        new CustomEvent("patchwork:open-document", {
          detail: { url },
          bubbles: true,
          composed: true,
        }),
      );
    };
    return html`
      <style>
        folder-list { display: block; padding: 0 0.25rem 0.5rem; }
        folder-list ul { list-style: none; padding: 0; margin: 0; }
        folder-list button {
          display: block;
          width: 100%;
          padding: 0.4rem 0.6rem;
          background: transparent;
          border: 0;
          border-radius: 4px;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        folder-list button:hover { background: rgba(0, 0, 0, 0.05); }
        folder-list button.selected,
        folder-list button.selected:hover {
          background: #dbeafe;
          color: #1d4ed8;
        }
      </style>
      <ul>
        <${For} each=${() => doc.docs ?? []}>
          ${(entry) => html`
            <li>
              <button
                type="button"
                onClick=${() => onOpen(entry.url)}
                classList=${() => ({ selected: isSelected(entry.url) })}
              >
                ${() => entry.name || "Untitled"}
              </button>
            </li>
          `}
        <//>
      </ul>
    `;
  }

  return render(() => (handle ? List() : Empty()), element);
}
