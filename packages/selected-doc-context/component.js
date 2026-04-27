import { createEffect, createRoot } from "https://esm.sh/solid-js@1.9.5";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

const accountSchema = {
  init: () => ({ "@patchwork": { type: "account" } }),
  parse: (value) => {
    if (!value || typeof value !== "object") {
      throw new Error("selected-doc-context: not an account doc");
    }
    if (value["@patchwork"]?.type !== "account") {
      throw new Error("selected-doc-context: doc is not type=account");
    }
    return value;
  },
};

export default function (element) {
  const account = element.closestComponent(accountSchema);
  if (!account) {
    console.warn(
      "selected-doc-context: no account ancestor; children will receive no doc context",
    );
    return;
  }

  return createRoot((dispose) => {
    const accountDoc = makeDocumentProjection(account.handle);

    createEffect(() => {
      const url = accountDoc.selectedDocUrl;
      if (!url) {
        // Nothing selected — leave existing children alone. We could
        // explicitly clear `doc=` here, but rebuilding child components
        // back to a "no doc" state is wasteful: most pages selecting
        // nothing on first load also haven't propagated `doc=` yet.
        return;
      }
      for (const child of element.componentChildren()) {
        if (child.getAttribute("doc") !== url) {
          child.setAttribute("doc", url);
        }
      }
    });

    return dispose;
  });
}
