import {
  isValidAutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";

import {
  AUTOMERGE_REPO_TAG,
  type AutomergeRepoElement,
} from "./automerge-repo-element";
import type { ComponentRoot, MountFn } from "../types";

/**
 * `WeakMap<Element, cleanup | null>` keyed by every element that has
 * been claimed by `mountComponent` and not yet unmounted. Three states:
 *
 * - not in the map: `el` is not a mounted component.
 * - value `null`: `el` is in flight (resolving doc context or running
 *   the user's mount fn), or has finished mounting with no user
 *   cleanup to install.
 * - value `() => void`: mounted with a user cleanup ready to run.
 *
 * The element is the identity carrier for a mounted component; there
 * is no Component instance. The map is the only persistent
 * per-component state in the system.
 *
 * Entries are claimed *synchronously* at the top of `mountComponent`.
 * That matters because the registry's `MutationObserver` may fire on
 * the same microtask for a freshly inserted element; without the
 * synchronous claim, the registry's `mountIfRegistered` would see the
 * element as un-claimed and start a duplicate mount.
 */
const cleanups = new WeakMap<Element, (() => void) | null>();

/**
 * Mount a component on `el` against `mountFn`. Synchronously claims
 * the element (so the registry sees it as already-mounted on the next
 * MutationObserver microtask) and stamps `el.repo` from the closest
 * `<automerge-repo>` ancestor, then runs the async lifecycle:
 *
 * 1. Resolve doc context — read `doc=`, find the closest
 *    `<automerge-repo>` ancestor, await `repo.find(url)`, stamp the
 *    resulting handle as `el.handle`. No `doc=` is fine and leaves
 *    `el.handle` undefined.
 * 2. If the element was disconnected during step 1, drop the claim
 *    and exit. The user's mount fn never runs.
 * 3. Run the user's `mountFn(el)`. If it throws, log and exit; the
 *    element stays claimed with no cleanup so a later removal is a
 *    safe no-op.
 * 4. If the element was disconnected while `mountFn` was awaiting,
 *    run the returned cleanup immediately and discard it instead of
 *    installing it. That's the race guarantee for in-flight mounts.
 * 5. Otherwise install the cleanup so a later `unmountElement(el)`
 *    (or rebuild) runs it.
 *
 * `el.isConnected` is the single source of truth for "is this mount
 * still current?". The registry triggers teardown by detaching the
 * element (rebuild) or relying on the DOM mutation that already
 * detached it (user removal); the in-flight closure observes the
 * disconnect on its next await boundary and self-tears-down.
 */
export function mountComponent(el: HTMLElement, mountFn: MountFn): void {
  cleanups.set(el, null);
  // Stamp `el.repo` synchronously, *before* any await, so a child mount
  // fn that runs while this component is still resolving its doc
  // context can already read the repo off any claimed ancestor. The
  // `<automerge-repo>` marker's `repo` is set by the registry's
  // tree-order walk before any descendant component reaches here.
  stampRepo(el);
  void runLifecycle(el, mountFn);
}

/**
 * Run the cleanup (if any) associated with `el` and forget the
 * element. Idempotent. Safe on elements that were never mounted (no-op),
 * on in-flight mounts (drops the claim so the in-flight closure's
 * `isConnected` check short-circuits the install path), and on
 * already-unmounted elements.
 *
 * Called by the registry when its `MutationObserver` sees `el` leave
 * the DOM, and explicitly during the rebuild path before swapping in
 * a fresh element.
 */
export function unmountElement(el: Element): void {
  const cleanup = cleanups.get(el);
  if (cleanup === undefined) return;
  cleanups.delete(el);
  if (cleanup) runCleanup(cleanup);
}

/**
 * Whether `el` is currently claimed by `mountComponent` (in flight or
 * fully mounted). Used by the registry's `mountIfRegistered` to dedup.
 */
export function isComponent(el: Element): boolean {
  return cleanups.has(el);
}

async function runLifecycle(
  el: HTMLElement,
  mountFn: MountFn,
): Promise<void> {
  try {
    await resolveContext(el);
  } catch (err) {
    console.error("[overlock-patchwork] doc context resolution failed:", err);
    cleanups.delete(el);
    return;
  }
  if (!el.isConnected) {
    cleanups.delete(el);
    return;
  }

  let result: (() => void) | void;
  try {
    result = await mountFn(el as ComponentRoot);
  } catch (err) {
    console.error(
      `[overlock-patchwork] mount threw on <${el.localName}>:`,
      err,
    );
    // Leave the entry as `null`. A later removal calls `unmountElement`
    // which sees `null` and is a clean no-op.
    return;
  }

  const cleanup = typeof result === "function" ? result : null;
  if (!el.isConnected) {
    if (cleanup) runCleanup(cleanup);
    cleanups.delete(el);
    return;
  }
  cleanups.set(el, cleanup);
}

/**
 * Read `doc=` off `el`, find the closest `<automerge-repo>` ancestor,
 * await `repo.find(url)`, and stamp the resulting handle onto the
 * element as `el.handle`. Strict: a `doc=` attribute without an
 * `<automerge-repo>` ancestor is an error. No `doc=` is fine and
 * leaves `el.handle` untouched.
 */
async function resolveContext(el: HTMLElement): Promise<void> {
  const docUrl = el.getAttribute("doc");
  if (!docUrl) return;

  const repoEl = el.closest(AUTOMERGE_REPO_TAG) as AutomergeRepoElement | null;
  if (!repoEl?.repo) {
    throw new Error(
      `[overlock-patchwork] <${el.localName} doc="${docUrl}"> requires an <${AUTOMERGE_REPO_TAG}> ancestor`,
    );
  }
  if (!isValidAutomergeUrl(docUrl)) {
    throw new Error(
      `[overlock-patchwork] doc attribute is not a valid automerge URL: "${docUrl}"`,
    );
  }

  const handle = await repoEl.repo.find(docUrl);
  (el as ComponentRoot).handle = handle as DocHandle<unknown>;
}

function stampRepo(el: HTMLElement): void {
  const repoEl = el.closest(AUTOMERGE_REPO_TAG) as AutomergeRepoElement | null;
  (el as ComponentRoot).repo = repoEl?.repo ?? undefined;
}

function runCleanup(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error("[overlock-patchwork] cleanup threw", err);
  }
}
