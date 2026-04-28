import type { DocHandle } from "@automerge/automerge-repo/slim";

import type { BranchableRepo } from "./branchable-repo";

/**
 * The element a mount fn receives. A plain `HTMLElement` plus:
 *
 * - `handle?` — the `DocHandle` resolved from the `doc=` attribute
 *   (absent when the host element had no `doc=`). The handle has stable
 *   identity across branch operations; switching branches swaps the
 *   handle's inner ref under the hood and surfaces as a `change` event,
 *   so consumers can listen with the standard `handle.on("change", …)`
 *   and don't need to re-acquire the reference.
 * - `repo?` — the `BranchableRepo` from the closest `<automerge-repo>`
 *   ancestor, stamped at construction time. Absent when the element is
 *   mounted outside any `<automerge-repo>` scope. The repo is stateful:
 *   `element.repo.checkout(...)` / `element.repo.fork(...)` /
 *   `element.repo.reset()` mutate the same instance in place. Call
 *   `element.repo.copy()` to obtain a fresh instance.
 */
export type ComponentRoot<V = unknown> = HTMLElement & {
  handle?: DocHandle<V>;
  repo?: BranchableRepo;
};

/**
 * A component's default export. Returns either nothing or a cleanup fn.
 *
 * The mount fn is `async` so authors can `await repo.find(...)`, dynamic
 * imports, etc. before they touch the element. Races (element removed
 * mid-mount, source hot-reloaded mid-mount, `doc=` flipped mid-mount)
 * are observed by `mountComponent` via `el.isConnected` after each
 * await: if the element disconnected while the mount fn was in flight,
 * the returned cleanup runs immediately and is discarded rather than
 * installed.
 */
export type MountFn = (
  element: ComponentRoot,
) => Promise<(() => void) | void> | ((() => void) | void);
