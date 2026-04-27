// Two-way bind `location.hash` to the enclosing account doc's
// `selectedDocUrl`. Hash-based (rather than the Navigation API) so the
// page works under file:// — sites opened off the local filesystem can't
// intercept navigations.
//
// URL shape: `…/index.html#automerge:<documentId>[?heads=…]`.

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
  if (!seg.startsWith("automerge:")) return null;
  // Don't try to be clever about heads here — pass through whatever the
  // hash claims. The repo will reject malformed URLs at find time.
  return seg;
}

export default function (element) {
  const account = element.closestComponent(accountSchema);
  if (!account) {
    console.warn("url-sync: no account ancestor; not syncing");
    return;
  }
  const handle = account.handle;

  const writeDocFromHash = () => {
    const url = hashToDocUrl();
    if (!url) return;
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
