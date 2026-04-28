// Wraps its children in an `<automerge-repo>` whose `.repo` starts equal
// to the enclosing repo and can be swapped (via the inner repo's
// `checkout` / `fork` / `reset` methods) to a forked / branched view.
// Branching state is local to this `<automerge-repo>` element — only
// descendants whose nearest enclosing `<automerge-repo>` is *this* one
// see the swap.
//
// The component itself doesn't track which branch is checked out; that's
// implicit in `repoEl.repo.branchHandle`. Use `<branch-picker>` (a
// descendant of this component) to drive the swap.

export default function (element) {
  const docUrl = element.getAttribute("doc");
  if (!docUrl) {
    console.warn("checked-out-branch-context: no `doc=` attribute");
    return;
  }

  // Move existing children into a new <automerge-repo> wrapper. The
  // registry's MutationObserver picks up the new element on the next
  // tick, inherits its `.repo` from the nearest enclosing
  // <automerge-repo> ancestor (the outer page-level one), and stamps
  // the rebuild hook used by the inner repo's mutator methods.
  const repoEl = document.createElement("automerge-repo");
  while (element.firstChild) repoEl.appendChild(element.firstChild);
  element.appendChild(repoEl);

  // Propagate `doc=` to component descendants. `componentChildren()`
  // descends through non-component boundaries (the new
  // <automerge-repo>, plus any wrapping `<header>`/`<div>`/etc.) to
  // find the nearest <patchwork-view>s and component instances. The
  // `.value()` is a stamp-time snapshot — fine here because this
  // provider only ever pushes `doc=` once per mount.
  for (const child of element.componentChildren().value()) {
    if (child.getAttribute("doc") !== docUrl) {
      child.setAttribute("doc", docUrl);
    }
  }
}
