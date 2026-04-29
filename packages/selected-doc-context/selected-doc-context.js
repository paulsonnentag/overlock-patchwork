import { createEffect, createRoot } from "https://esm.sh/solid-js@1.9.5";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";
// ─── Sibling library URL ────────────────────────────────────────────────
//
// After `pnpm push packages` runs, copy `rootDirectoryUrl` from
// `packages/solid-helpers/.pushwork/snapshot.json` and paste it in
// place of the placeholder below, then re-run `pnpm push packages`.
// The URL stays stable across subsequent pushes.
import { findHandleByPatchworkType } from "automerge:2aqfwfd7XjcbAHBGFB27WqGnoWB7/solid-helpers.js";

export default function (element) {
  const accountHandle = findHandleByPatchworkType(element, "account");
  if (!accountHandle) {
    console.warn(
      "selected-doc-context: no <patchwork-context> with an account doc handle; children will receive no doc context",
    );
    return;
  }

  return createRoot((dispose) => {
    const accountDoc = makeDocumentProjection(accountHandle);

    createEffect(() => {
      const url = accountDoc.selectedDocUrl;
      if (!url) {
        // Nothing selected — leave existing children alone. We could
        // explicitly clear `doc=` here, but rebuilding child views back
        // to a "no doc" state is wasteful: most pages selecting nothing
        // on first load also haven't propagated `doc=` yet.
        return;
      }
      for (const child of element.children) {
        if (child.getAttribute("doc") !== url) {
          child.setAttribute("doc", url);
        }
      }
    });

    return dispose;
  });
}
