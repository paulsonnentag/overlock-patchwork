import { createEffect, createRoot } from "https://esm.sh/solid-js@1.9.5";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";
// ─── Sibling library URL ────────────────────────────────────────────────
//
// After `pnpm push packages` runs, copy `rootDirectoryUrl` from
// `packages/solid-helpers/.pushwork/snapshot.json` and paste it in
// place of the placeholder below, then re-run `pnpm push packages`.
// The URL stays stable across subsequent pushes.
import { fromHandle } from "automerge:2aqfwfd7XjcbAHBGFB27WqGnoWB7/solid-helpers.js";

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
  const account = element.closestView(accountSchema).value();
  if (!account) {
    console.warn(
      "selected-doc-context: no account ancestor; children will receive no doc context",
    );
    return;
  }

  return createRoot((dispose) => {
    const accountDoc = makeDocumentProjection(account.handle);

    // Bridge `childViews()` into a Solid signal so the effect re-fires
    // on both inputs: the account doc's `selectedDocUrl` *and* late-
    // mounting child views.
    const children = fromHandle(element.childViews());

    createEffect(() => {
      const url = accountDoc.selectedDocUrl;
      if (!url) {
        // Nothing selected — leave existing children alone. We could
        // explicitly clear `doc=` here, but rebuilding child components
        // back to a "no doc" state is wasteful: most pages selecting
        // nothing on first load also haven't propagated `doc=` yet.
        return;
      }
      for (const child of children()) {
        if (child.getAttribute("doc") !== url) {
          child.setAttribute("doc", url);
        }
      }
    });

    return dispose;
  });
}
