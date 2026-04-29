// Owns the branched-repo subtree. Wraps existing children in an inner
// `<patchwork-context>` whose `value` starts as the parent
// `BranchableRepo` (so descendants pick it up via the framework's
// `findRepo` walk) and listens for intent events bubbling from the
// picker:
//
//   patchwork:checkout-branch  { detail: { url } }
//   patchwork:fork-branch      { detail: { name } }
//   patchwork:reset-branch     no detail
//
// Each handler calls the matching method on the *parent* repo —
// always reachable as `element.repo`, since this element sits outside
// its own inner context — receives a fresh `BranchableRepo` (the
// wrapper is immutable; fork/checkout/reset return new instances),
// writes it onto the inner context's `source`, and rebuilds the
// subtree so descendants re-resolve `el.repo`. The rebuild detaches
// every descendant and inserts fresh empty clones with the same tag
// and attributes — Solid's `dispose()` tears down reactivity but
// leaves the rendered DOM in place, so reusing the same element
// across re-mount would stack its rendered output on the previous
// run's leftovers.
//
// The element's own `doc=` (the selected doc URL, propagated by an
// outer `<selected-doc-context>`) is forwarded to every view-like
// descendant under the inner context. On a parent `doc=` flip the
// framework rebuilds this element; on rebuild we recreate descendants
// (so the new doc's mount runs against clean elements) and reset the
// inner repo to the parent — branch state is per-doc.

export default function (element) {
  const repo = element.repo;
  const docHandle = element.handle;
  if (!repo || !docHandle) {
    console.warn(
      "checked-out-branch-context: requires el.repo and a `doc=` handle",
    );
    return;
  }

  // First mount vs. rebuild: on rebuild the previous mount's inner
  // context is moved across by `#rebuildInstance` (cleanup unwires
  // listeners but leaves DOM intact). Reuse it so we keep the same
  // EventTarget identity, but recreate every descendant with a fresh
  // empty element underneath — see file header for why.
  let inner = element.querySelector(":scope > patchwork-context");
  const isFirstMount = !inner;
  if (isFirstMount) {
    inner = document.createElement("patchwork-context");
    while (element.firstChild) inner.appendChild(element.firstChild);
    element.appendChild(inner);
  }
  inner.source = repo;

  if (isFirstMount) {
    // Children are the parent template's originals (pre-bootstrap
    // `<patchwork-view>` elements). Set `doc=` on view-like
    // descendants in place; the cascade will bootstrap them with
    // the right `doc=` already in attribute storage.
    applyDocUrl(inner, docHandle.url);
  } else {
    refreshDescendants(docHandle.url);
  }

  // Guard against a parent `doc=` flip (which tears down this mount
  // and stands up a fresh one) racing with an in-flight fork /
  // checkout: the resolved promise from the old mount must not flip
  // the inner context's source after the new mount has already
  // re-targeted it.
  let alive = true;

  const swapRepo = (nextRepo) => {
    inner.source = nextRepo;
    refreshDescendants(docHandle.url);
  };

  function refreshDescendants(url) {
    // Capture before mutating; build all the fresh clones detached so
    // the MO only sees one "remove old, add fresh" pair per child
    // when we apply them. Setting `doc=` on detached fresh elements
    // doesn't surface as an MO record (the document doesn't observe
    // outside its tree), so the registered views start their next
    // mount with the correct attribute already in place.
    const oldChildren = Array.from(inner.children);
    const replacements = oldChildren.map((old) => {
      const fresh = recreateElement(old);
      applyDocUrl(fresh, url);
      return fresh;
    });
    for (const old of oldChildren) old.remove();
    for (const fresh of replacements) inner.appendChild(fresh);
  }

  const onCheckout = async (event) => {
    const url = event.detail?.url;
    if (!url || !window.AutomergeRepo.isValidAutomergeUrl(url)) return;
    try {
      const next = await repo.checkout(url);
      if (!alive) return;
      swapRepo(next);
    } catch (err) {
      console.error("checked-out-branch-context: checkout failed:", err);
    }
  };

  const onReset = () => {
    if (!alive) return;
    swapRepo(repo.reset());
  };

  const onFork = async (event) => {
    const name = event.detail?.name ?? null;
    try {
      const forked = await repo.fork({ urls: [docHandle.url], name });
      if (!alive) return;
      // Lazily create the branch-index doc and link it from the
      // original. Subsequent forks just append to the existing
      // index. Writes go through the parent (off-branch) repo so
      // the index stays out of branch clones — pure-read traffic
      // through the wrapped repo doesn't COW, but writes do.
      const existingIndexUrl =
        docHandle.doc()?.["@patchwork"]?.branchIndexUrl ?? null;
      let indexHandle;
      if (!existingIndexUrl) {
        indexHandle = repo.create({
          "@patchwork": { type: "branch-index" },
          branches: [],
        });
        docHandle.change((d) => {
          if (!d["@patchwork"]) d["@patchwork"] = {};
          d["@patchwork"].branchIndexUrl = indexHandle.url;
        });
      } else {
        indexHandle = await repo.find(existingIndexUrl);
        if (!alive) return;
      }
      indexHandle.change((d) => {
        if (!Array.isArray(d.branches)) d.branches = [];
        d.branches.push(forked.branchHandle.url);
      });
      swapRepo(forked);
    } catch (err) {
      console.error("checked-out-branch-context: fork failed:", err);
    }
  };

  element.addEventListener("patchwork:checkout-branch", onCheckout);
  element.addEventListener("patchwork:reset-branch", onReset);
  element.addEventListener("patchwork:fork-branch", onFork);

  return () => {
    alive = false;
    element.removeEventListener("patchwork:checkout-branch", onCheckout);
    element.removeEventListener("patchwork:reset-branch", onReset);
    element.removeEventListener("patchwork:fork-branch", onFork);
  };
}

// Walk descendants of `root`, setting `doc=url` on every
// `<patchwork-view>` and on every other custom element except
// `<patchwork-context>`. Plain elements (`<header>`, `<div>`, …) are
// transparent — we recurse into their children. `<patchwork-context>`
// is transparent too: contexts may stack inside this subtree (e.g. a
// future nested branch), and the propagation needs to reach the
// `<patchwork-view>`s underneath.
//
// Stops at view-like nodes (custom-element tag): their internals are
// the view's private DOM, not part of the doc-context tree.
function applyDocUrl(root, url) {
  for (const child of root.children) {
    const tag = child.localName;
    if (tag === "patchwork-context") {
      applyDocUrl(child, url);
    } else if (tag === "patchwork-view" || tag.includes("-")) {
      if (child.getAttribute("doc") !== url) {
        child.setAttribute("doc", url);
      }
    } else {
      applyDocUrl(child, url);
    }
  }
}

// Build an empty clone of `old` carrying the same tag and attributes.
// Plain elements (no hyphen), `<patchwork-context>`, and
// `<patchwork-view>` recurse — the structure is part of the user's
// authored markup. Other custom elements are mounted-view boundaries
// whose contents come from their own mount fn, so they're recreated
// empty.
function recreateElement(old) {
  if (old.nodeType !== Node.ELEMENT_NODE) return old.cloneNode(true);
  const fresh = old.ownerDocument.createElement(old.localName);
  for (const attr of Array.from(old.attributes)) {
    fresh.setAttribute(attr.name, attr.value);
  }
  const tag = old.localName;
  const isMountedViewBoundary =
    tag.includes("-") && tag !== "patchwork-context" && tag !== "patchwork-view";
  if (!isMountedViewBoundary) {
    for (const child of old.childNodes) {
      fresh.appendChild(recreateElement(child));
    }
  }
  return fresh;
}
