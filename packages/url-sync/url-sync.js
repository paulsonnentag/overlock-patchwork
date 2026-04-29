// Two-way bind `location.hash` to the enclosing account doc's
// `selectedDocUrl`. Hash-based (rather than the Navigation API) so the
// page works under file:// — sites opened off the local filesystem can't
// intercept navigations.
//
// URL shape: `…/index.html#<AutomergeUrl>`. We strip any heads on the
// way in: this view always tracks the live document, and a heads-bearing
// URL persisted on the account doc would lock every future session to a
// snapshot.

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
      "url-sync: no <patchwork-context> with an account doc handle; not syncing",
    );
    return;
  }
  return bind(accountHandle);
}

function bind(handle) {
  const writeDocFromHash = () => {
    const url = hashToDocUrl();
    if (!url) return;
    // Canonicalize the bar even when the doc already matches — the user
    // may have pasted a `?heads=…` URL whose canonical form is what's
    // already selected.
    const target = `#${url}`;
    if (location.hash !== target) {
      history.replaceState(null, "", target);
    }
    if (handle.doc()?.selectedDocUrl === url) return;
    handle.change((d) => {
      d.selectedDocUrl = url;
    });
  };

  const writeHashFromDoc = () => {
    const url = handle.doc()?.selectedDocUrl;
    if (!url) return;
    const target = `#${url}`;
    if (location.hash !== target) {
      history.replaceState(null, "", target);
    }
  };

  window.addEventListener("hashchange", writeDocFromHash);
  handle.on("change", writeHashFromDoc);

  // First-paint priority: a hash in the URL beats the stored selection.
  // Otherwise mirror the doc onto the bar so the page is bookmarkable
  // immediately.
  if (hashToDocUrl()) {
    writeDocFromHash();
  } else {
    writeHashFromDoc();
  }

  return () => {
    window.removeEventListener("hashchange", writeDocFromHash);
    handle.off("change", writeHashFromDoc);
  };
}

function hashToDocUrl() {
  const seg = location.hash.slice(1);
  if (!window.AutomergeRepo.isValidAutomergeUrl(seg)) return null;
  // Round-trip through the native helpers so any heads in the hash get
  // dropped before they can land in `selectedDocUrl`.
  const { documentId } = window.AutomergeRepo.parseAutomergeUrl(seg);
  return window.AutomergeRepo.stringifyAutomergeUrl({ documentId });
}
