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
  const repo = element.repo;
  const accountHandle = findHandleByPatchworkType(element, "account");
  if (!accountHandle) {
    // No account ancestor — render-as-passthrough is the right
    // default; children remain in the DOM but receive no folder
    // context. Mirrors the old behavior when `closestView(accountSchema)`
    // returned no match.
    console.warn(
      "root-folder-context: no <patchwork-context> with an account doc handle; children will receive no doc context",
    );
    return;
  }

  return createRoot((dispose) => {
    const accountDoc = makeDocumentProjection(accountHandle);

    createEffect(() => {
      let url = accountDoc.rootFolderUrl;
      if (!url) {
        // First-run bootstrap: create the root folder doc and link it
        // from the account. The write re-fires this effect, which then
        // takes the propagation branch with the now-set url.
        const folder = repo.create({
          "@patchwork": { type: "folder" },
          title: "Root",
          docs: [],
        });
        accountHandle.change((d) => {
          d.rootFolderUrl = folder.url;
        });
        return;
      }
      // Propagate to direct children regardless of whether they're
      // still un-bootstrapped <patchwork-view> elements (the framework
      // carries `doc=` over on the swap) or already-mounted views (the
      // registry's MutationObserver schedules a rebuild).
      for (const child of element.children) {
        if (child.getAttribute("doc") !== url) {
          child.setAttribute("doc", url);
        }
      }
    });

    return dispose;
  });
}
