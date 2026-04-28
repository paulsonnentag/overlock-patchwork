import { createEffect, createRoot } from "https://esm.sh/solid-js@1.9.5";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

// Account schema kept inline so the package is self-contained — see the
// reusability design goal in docs/components.md. Only the fields this
// component reads are validated; everything else is passed through.
const accountSchema = {
  init: () => ({ "@patchwork": { type: "account" } }),
  parse: (value) => {
    if (!value || typeof value !== "object") {
      throw new Error("root-folder-context: not an account doc");
    }
    if (value["@patchwork"]?.type !== "account") {
      throw new Error("root-folder-context: doc is not type=account");
    }
    return value;
  },
};

export default function (element) {
  const account = element.closestComponent(accountSchema).value();
  if (!account) {
    // No account ancestor — render-as-passthrough is the right default;
    // children remain in the DOM but receive no doc context.
    console.warn(
      "root-folder-context: no account ancestor; children will receive no doc context",
    );
    return;
  }

  // Snapshot of current child components. The `Subscribable` will start
  // re-firing once the framework wires structural triggers; until then
  // it carries the mount-time list, which matches the pre-existing
  // "providers don't see children added after mount" semantics.
  const children$ = element.componentChildren();

  return createRoot((dispose) => {
    const accountDoc = makeDocumentProjection(account.handle);

    createEffect(() => {
      const url = accountDoc.rootFolderUrl;
      if (!url) return;
      for (const child of children$.value()) {
        if (child.getAttribute("doc") !== url) {
          child.setAttribute("doc", url);
        }
      }
    });

    return dispose;
  });
}
