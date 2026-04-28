// Two-way bind `location.hash` to the enclosing account doc's
// `selectedDocUrl`. Hash-based (rather than the Navigation API) so the
// page works under file:// — sites opened off the local filesystem can't
// intercept navigations.
//
// URL shape: `…/index.html#<AutomergeUrl>`. We strip any heads on the
// way in: this view always tracks the live document, and a heads-bearing
// URL persisted on the account doc would lock every future session to a
// snapshot.

import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "https://esm.sh/@automerge/automerge-repo@2/slim";

const accountSchema = {
  init: () => ({ "@patchwork": { type: "account" } }),
  parse: (value) => {
    if (!value || typeof value !== "object") {
      throw new Error("url-sync: not an account doc");
    }
    if (value["@patchwork"]?.type !== "account") {
      throw new Error("url-sync: doc is not type=account");
    }
    return value;
  },
};

function hashToDocUrl() {
  const seg = location.hash.slice(1);
  if (!isValidAutomergeUrl(seg)) return null;
  // Round-trip through the native helpers so any heads in the hash get
  // dropped before they can land in `selectedDocUrl`.
  const { documentId } = parseAutomergeUrl(seg);
  return stringifyAutomergeUrl({ documentId });
}

export default function (element) {
  const account = element.closestView(accountSchema).value();
  if (!account) {
    console.warn("url-sync: no account ancestor; not syncing");
    return;
  }
  const handle = account.handle;

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
