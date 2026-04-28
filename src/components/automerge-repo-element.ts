import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

import type { BranchableRepo, ForkOpts } from "../branchable-repo";

export const AUTOMERGE_REPO_TAG = "automerge-repo"

/**
 * Scope marker for a `Repo` instance. Descendant `<patchwork-view>`s
 * resolve their `doc=` attribute against `closest("automerge-repo").repo`.
 *
 * The element holds a reference to the repo as a property (not an
 * attribute — repos aren't strings). The `ComponentRegistry` injects the
 * initial repo on discovery; it inherits from the closest enclosing
 * `<automerge-repo>` ancestor (if any), or falls back to the registry's
 * root repo.
 *
 * The element exposes `checkout` / `fork` / `reset` mutators that update
 * its `.repo` *in place* — the same `BranchableRepo` instance is
 * navigated to a different branch (or back off-branch). Existing
 * `BranchedDocHandle`s rewire to the new branch silently. After each
 * mutation, every component descendant that resolves against this
 * `<automerge-repo>` is rebuilt so its `doc=` re-resolves through the
 * updated repo. The rebuild hook is set by the `ComponentRegistry` (via
 * `_rebuildDescendants`) the first time it sees this element.
 */
export class AutomergeRepoElement extends HTMLElement {
  repo: BranchableRepo | null = null;
  /** @internal */
  _rebuildDescendants: (() => void) | null = null;

  async checkout(branchDocUrl: AutomergeUrl): Promise<BranchableRepo> {
    if (!this.repo) {
      throw new Error("automerge-repo: cannot checkout before .repo is set");
    }
    await this.repo.checkout(branchDocUrl);
    this._rebuildDescendants?.();
    return this.repo;
  }

  async fork(opts: ForkOpts = {}): Promise<BranchableRepo> {
    if (!this.repo) {
      throw new Error("automerge-repo: cannot fork before .repo is set");
    }
    await this.repo.fork(opts);
    this._rebuildDescendants?.();
    return this.repo;
  }

  reset(): BranchableRepo {
    if (!this.repo) {
      throw new Error("automerge-repo: cannot reset before .repo is set");
    }
    this.repo.reset();
    this._rebuildDescendants?.();
    return this.repo;
  }

  // Element.moveBefore() fires this *instead of* connect/disconnect when
  // present. The registry's repo injection runs once per element via
  // tree walk + addedNodes records, so a move would otherwise look like
  // a removal followed by an insertion and could re-stamp `.repo` from
  // a different ancestor — declaring this no-op keeps the existing
  // `.repo` intact across moves.
  connectedMoveCallback(): void {}
}


if (!customElements.get(AUTOMERGE_REPO_TAG)) {
  customElements.define(AUTOMERGE_REPO_TAG, AutomergeRepoElement);
}