import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

function Counter({ handle }) {
  const doc = makeDocumentProjection(handle);
  const inc = () => handle.change((d) => (d.count = (d.count ?? 0) + 1));
  return html`
    <button type="button" onClick=${inc}>
      count: ${() => doc.count ?? 0}
    </button>
  `;
}

export default async function (element) {
  const handle = element.handle;
  if (!handle) {
    throw new Error("my-counter requires a doc= attribute on its <patchwork-view>");
  }
  return render(() => Counter({ handle }), element);
}
