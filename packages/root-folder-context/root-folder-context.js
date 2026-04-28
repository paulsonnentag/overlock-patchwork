import { createEffect, createRoot } from "https://esm.sh/solid-js@1.9.5";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";
// ─── Sibling library URL ────────────────────────────────────────────────
//
// After `pnpm push packages` runs, copy `rootDirectoryUrl` from
// `packages/solid-helpers/.pushwork/snapshot.json` and paste it in
// place of the placeholder below, then re-run `pnpm push packages`.
// The URL stays stable across subsequent pushes.
import { fromHandle } from "automerge:2aqfwfd7XjcbAHBGFB27WqGnoWB7/solid-helpers.js";

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
  const account = element.closestView(accountSchema).value();
  if (!account) {
    // No account ancestor — render-as-passthrough is the right default;
    // children remain in the DOM but receive no doc context.
    console.warn(
      "root-folder-context: no account ancestor; children will receive no doc context",
    );
    return;
  }

  return createRoot((dispose) => {
    const accountDoc = makeDocumentProjection(account.handle);

    // Bridge `childViews()` into a Solid signal so the effect re-fires
    // on both inputs: the account doc's `rootFolderUrl` *and* late-
    // mounting child views.
    const children = fromHandle(element.childViews());

    createEffect(() => {
      const url = accountDoc.rootFolderUrl;
      if (!url) return;
      for (const child of children()) {
        if (child.getAttribute("doc") !== url) {
          child.setAttribute("doc", url);
        }
      }
    });

    return dispose;
  });
}
