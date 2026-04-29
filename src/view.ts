import {
  isValidAutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";

import { BranchableRepo } from "./branchable-repo";
import {
  PATCHWORK_CONTEXT_TAG,
  type PatchworkContext,
} from "./patchwork-context-element";

/**
 * The element a mount fn receives. A plain `HTMLElement` plus:
 *
 * - `handle?` — the `DocHandle` resolved from the `doc=` attribute
 *   (absent when the host element had no `doc=`).
 * - `repo` — the `BranchableRepo` carried by the nearest ancestor
 *   `<patchwork-context>` whose value is a `BranchableRepo`. The
 *   bootstrap installs one such provider wrapping `<body>`, so every
 *   view that doesn't sit inside a more specific repo provider ends
 *   up with the page-level repo. `BranchableRepo` exposes
 *   `fork`/`checkout`/`reset` (each returns a new instance over the
 *   same underlying `Repo`); there is currently no UI wired up that
 *   invokes them.
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
 * Per-view state. The `mounted` promise is the synchronisation point
 * for top-down mounting: each view awaits the closest ancestor view's
 * `mounted` before resolving its own context and running the user
 * mount fn. It resolves on success (or clean disconnect) and rejects
 * on error so descendants stay un-mounted when an ancestor fails.
 *
 * `cleanup` is null while the user mount fn is in flight or if the
 * fn returned no cleanup; otherwise it's the function `unmountView`
 * runs at teardown.
 */
type ViewState = {
  mounted: Promise<void>;
  cleanup: (() => void) | null;
};

/**
 * `WeakMap<Element, ViewState>` keyed by every element claimed by
 * `mountView`. Entries are claimed *synchronously* at the top of
 * `mountView` (before any await) so the registry's `MutationObserver`
 * microtask sees the element as already-claimed and dedups.
 *
 * The element is the identity carrier for a mounted view; there is
 * no separate `View` instance.
 */
const views = new WeakMap<Element, ViewState>();

/**
 * Claim `el` as a view backed by `mountFn`. Synchronously records the
 * claim, walks up to the nearest `<patchwork-context>` whose value is
 * a `BranchableRepo` to stamp `el.repo`, and starts the async mount
 * pipeline. Returns the promise that resolves once the user mount fn
 * has settled (or rejects if it threw); callers that need to cascade
 * into descendants after a successful mount listen on the resolution.
 *
 * Top-down sequencing is enforced inside the pipeline: before
 * resolving `doc=` or running the user mount fn, the new view awaits
 * the closest ancestor view's `mounted`. That guarantees ancestor
 * `el.handle`, `<patchwork-context>` `source`, and any imperative
 * descendant mutations the ancestor performs are all visible by the
 * time a descendant runs.
 */
export function mountView(el: HTMLElement, mountFn: MountFn): Promise<void> {
  const existing = views.get(el);
  if (existing) return existing.mounted;
  const state: ViewState = { mounted: undefined!, cleanup: null };
  views.set(el, state);
  (el as ViewElement).repo = findRepo(el);
  state.mounted = mount(el, mountFn);
  return state.mounted;
}

/**
 * Run the cleanup (if any) associated with `el` and forget the
 * element. Idempotent. Safe on elements that were never mounted (no-op),
 * on in-flight mounts (drops the claim so the in-flight closure's
 * `isConnected` check short-circuits the install path), and on
 * already-unmounted elements.
 */
export function unmountView(el: Element): void {
  const state = views.get(el);
  if (!state) return;
  views.delete(el);
  if (state.cleanup) runCleanup(state.cleanup);
}

/**
 * Whether `el` is currently claimed by `mountView` (in flight or
 * fully mounted). Used by the registry's mount path to dedup and by
 * the descendant walk to stop at view boundaries.
 */
export function isView(el: Element): boolean {
  return views.has(el);
}

/**
 * The mounted-promise for `el`, or null if `el` is not a claimed view.
 * Exposed for tests and tooling; the runtime itself reads ancestor
 * promises through the WeakMap directly.
 */
export function viewMounted(el: Element): Promise<void> | null {
  return views.get(el)?.mounted ?? null;
}

async function mount(el: HTMLElement, mountFn: MountFn): Promise<void> {
  // Top-down barrier: wait for the closest ancestor view to finish
  // mounting before this view does anything observable. Ancestor
  // failure propagates as the promise rejection — descendants stay
  // un-mounted in that subtree.
  const ancestor = findAncestorMounted(el);
  if (ancestor) {
    try {
      await ancestor;
    } catch {
      views.delete(el);
      return;
    }
  }
  if (!el.isConnected) {
    views.delete(el);
    return;
  }

  try {
    await resolveContext(el);
  } catch (err) {
    console.error("[overlock-patchwork] doc context resolution failed:", err);
    throw err;
  }
  if (!el.isConnected) {
    views.delete(el);
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
    throw err;
  }

  const cleanup = typeof result === "function" ? result : null;
  if (!el.isConnected) {
    if (cleanup) runCleanup(cleanup);
    views.delete(el);
    return;
  }
  const state = views.get(el);
  if (state) state.cleanup = cleanup;
}

function findAncestorMounted(el: HTMLElement): Promise<void> | null {
  let cur = el.parentElement;
  while (cur) {
    const state = views.get(cur);
    if (state) return state.mounted;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Read `doc=` off `el` and stamp `el.repo.find(url)` onto the element
 * as `el.handle`. No `doc=` is fine and leaves `el.handle` untouched.
 * `el.repo` is already stamped by `mountView` from the nearest
 * `<patchwork-context>` provider.
 */
async function resolveContext(el: HTMLElement): Promise<void> {
  const docUrl = el.getAttribute("doc");
  if (!docUrl) return;

  if (!isValidAutomergeUrl(docUrl)) {
    throw new Error(
      `[overlock-patchwork] doc attribute is not a valid automerge URL: "${docUrl}"`,
    );
  }

  const handle = await (el as ViewElement).repo.find(docUrl);
  (el as ViewElement).handle = handle as DocHandle<unknown>;
}

/**
 * Walk up from `el` looking for the nearest `<patchwork-context>`
 * whose `value` is a `BranchableRepo`. `closest()` matches the
 * element itself; if the matched context carries a non-repo value,
 * we step past it via `parentElement` and keep walking. Throws if
 * no provider is in scope — the bootstrap in `main.ts` installs one
 * wrapping `<body>` so this is only reachable on a misconfigured
 * page.
 */
function findRepo(el: Element): BranchableRepo {
  let cur: Element | null = el;
  while (cur) {
    const ctx = cur.closest(PATCHWORK_CONTEXT_TAG) as PatchworkContext | null;
    if (!ctx) break;
    const value = ctx.value;
    if (value instanceof BranchableRepo) return value;
    cur = ctx.parentElement;
  }
  throw new Error(
    `[overlock-patchwork] <${el.localName}>: no <patchwork-context> with a BranchableRepo value in scope`,
  );
}

function runCleanup(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error("[overlock-patchwork] cleanup threw", err);
  }
}
