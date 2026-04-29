import {
  isValidAutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";

import type { BranchableRepo } from "./branchable-repo";

/**
 * The element a mount fn receives. A plain `HTMLElement` plus:
 *
 * - `handle?` — the `DocHandle` resolved from the `doc=` attribute
 *   (absent when the host element had no `doc=`).
 * - `repo` — the page's single `BranchableRepo` (`window.repo`),
 *   stamped onto every mounted view for convenience. There is no
 *   per-subtree repo scope; every view sees the same instance.
 *   `BranchableRepo` exposes `fork`/`checkout`/`reset` for git-style
 *   branching, but there is currently no UI mechanism wired up that
 *   actually invokes them — the page always runs against the
 *   un-branched root.
 */
export type ViewElement<V = unknown> = HTMLElement & {
  handle?: DocHandle<V>;
  repo: BranchableRepo;
};

/**
 * A view's default export. Returns either nothing or a cleanup fn.
 *
 * The mount fn is `async` so authors can `await repo.find(...)`, dynamic
 * imports, etc. before they touch the element. Races (element removed
 * mid-mount, source hot-reloaded mid-mount, `doc=` flipped mid-mount)
 * are observed by `mountView` via `el.isConnected` after each await:
 * if the element disconnected while the mount fn was in flight, the
 * returned cleanup runs immediately and is discarded rather than
 * installed.
 */
export type MountFn = (
  element: ViewElement,
) => Promise<(() => void) | void> | ((() => void) | void);

/**
 * `WeakMap<Element, cleanup | null>` keyed by every element that has
 * been claimed by `mountView` and not yet unmounted. Three states:
 *
 * - not in the map: `el` is not a mounted view.
 * - value `null`: `el` is in flight (resolving doc context or running
 *   the user's mount fn), or has finished mounting with no user
 *   cleanup to install.
 * - value `() => void`: mounted with a user cleanup ready to run.
 *
 * The element is the identity carrier for a mounted view; there is no
 * View instance. The map is the only persistent per-view state in the
 * system.
 *
 * Entries are claimed *synchronously* at the top of `mountView`. That
 * matters because the registry's `MutationObserver` may fire on the
 * same microtask for a freshly inserted element; without the
 * synchronous claim, the registry's `mountIfRegistered` would see the
 * element as un-claimed and start a duplicate mount.
 */
const cleanups = new WeakMap<Element, (() => void) | null>();

/**
 * Mount a view on `el` against `mountFn`. Synchronously claims the
 * element (so the registry sees it as already-mounted on the next
 * MutationObserver microtask), stamps `window.repo` as `el.repo`, then
 * runs the async lifecycle:
 *
 * 1. Resolve doc context — read `doc=`, await `window.repo.find(url)`,
 *    stamp the resulting handle as `el.handle`. No `doc=` is fine and
 *    leaves `el.handle` untouched.
 * 2. If the element was disconnected during step 1, drop the claim and
 *    exit. The user's mount fn never runs.
 * 3. Run the user's `mountFn(el)`. If it throws, log and exit; the
 *    element stays claimed with no cleanup so a later removal is a
 *    safe no-op.
 * 4. If the element was disconnected while `mountFn` was awaiting,
 *    run the returned cleanup immediately and discard it instead of
 *    installing it. That's the race guarantee for in-flight mounts.
 * 5. Otherwise install the cleanup so a later `unmountView(el)`
 *    (or rebuild) runs it.
 */
export function mountView(el: HTMLElement, mountFn: MountFn): void {
  cleanups.set(el, null);
  (el as ViewElement).repo = window.repo;
  void runLifecycle(el, mountFn);
}

/**
 * Run the cleanup (if any) associated with `el` and forget the
 * element. Idempotent. Safe on elements that were never mounted (no-op),
 * on in-flight mounts (drops the claim so the in-flight closure's
 * `isConnected` check short-circuits the install path), and on
 * already-unmounted elements.
 */
export function unmountView(el: Element): void {
  const cleanup = cleanups.get(el);
  if (cleanup === undefined) return;
  cleanups.delete(el);
  if (cleanup) runCleanup(cleanup);
}

/**
 * Whether `el` is currently claimed by `mountView` (in flight or
 * fully mounted). Used by the registry's `mountIfRegistered` to dedup.
 */
export function isView(el: Element): boolean {
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
    result = await mountFn(el as ViewElement);
  } catch (err) {
    console.error(
      `[overlock-patchwork] mount threw on <${el.localName}>:`,
      err,
    );
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
 * Read `doc=` off `el` and stamp `window.repo.find(url)` onto the
 * element as `el.handle`. No `doc=` is fine and leaves `el.handle`
 * untouched.
 */
async function resolveContext(el: HTMLElement): Promise<void> {
  const docUrl = el.getAttribute("doc");
  if (!docUrl) return;

  if (!isValidAutomergeUrl(docUrl)) {
    throw new Error(
      `[overlock-patchwork] doc attribute is not a valid automerge URL: "${docUrl}"`,
    );
  }
  const repo = window.repo;
  if (!repo) {
    throw new Error(
      `[overlock-patchwork] <${el.localName} doc="${docUrl}"> resolved before window.repo was set`,
    );
  }

  const handle = await repo.find(docUrl);
  (el as ViewElement).handle = handle as DocHandle<unknown>;
}

function runCleanup(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error("[overlock-patchwork] cleanup threw", err);
  }
}
