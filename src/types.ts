import type { DocHandle } from "@automerge/automerge-repo/slim";

import type { BranchableRepo } from "./branchable-repo";
import type { Subscribable } from "./subscribable";

export type ComponentManifest = {
  name: string;
  url: string;
};

/**
 * Generic schema interface used by `closestComponent` / `ancestorComponent`
 * for structural ancestor matching. Components don't register schemas with
 * the framework; consumers pass a schema at lookup time and the walker
 * tries `schema.parse(handle.doc())` against each candidate ancestor's
 * `DocHandle`. The first parse that doesn't throw wins.
 *
 * The interface is duck-typed on purpose so authors can pick whichever
 * validation library they prefer (Zod, Valibot, ArkType, hand-rolled, …).
 * `init()` is for the consumer's own use — typically when bootstrapping a
 * fresh document — and is never invoked by the framework.
 *
 * Example Zod adapter:
 *
 *     import { z } from "https://esm.sh/zod@3";
 *     const shape = z.object({ count: z.number() });
 *     export const counterSchema = {
 *       init: () => ({ count: 0 }),
 *       parse: (v) => shape.parse(v),
 *     };
 */
export type Schema<T> = {
  init(): T;
  parse(value: unknown): T;
};

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
 * - `closestComponent(schema)` — walk self → ancestors; return the first
 *   element whose handle's doc parses under `schema`. Returns a
 *   `Subscribable` whose value is the match (or `null` if none).
 * - `ancestorComponent()` — walk parent → ancestors; return the first
 *   registered component, regardless of handle. Returns a
 *   `Subscribable` whose value is the match (or `null`).
 * - `ancestorComponent(schema)` — same walk, but apply the parse filter.
 * - `componentChildren()` — walk descendants, stopping at component
 *   boundaries. Returns a `Subscribable` whose value is the nearest
 *   component descendants — both already-swapped components and still-
 *   bootstrapping `<patchwork-view>`s. Used by context-provider
 *   components to enumerate their direct child components without
 *   caring whether the registry has finished its per-element bootstrap.
 * - `componentChildren(schema)` — same walk, with the schema-parse
 *   filter applied to candidates' `handle.doc()`. Pre-swap
 *   `<patchwork-view>`s have no handle yet and are skipped under
 *   schema filtering.
 *
 * The lookups currently capture a single snapshot at stamp time — the
 * `Subscribable` fires once on `subscribe` with that snapshot and never
 * again. Triggers that re-fire on DOM/context changes will be wired up
 * in a follow-up.
 */
export type ComponentRoot<V = unknown> = HTMLElement & {
  handle?: DocHandle<V>;
  repo?: BranchableRepo;
  closestComponent<T>(
    schema: Schema<T>,
  ): Subscribable<SchemaComponentRoot<T> | null>;
  ancestorComponent(): Subscribable<ComponentRoot | null>;
  ancestorComponent<T>(
    schema: Schema<T>,
  ): Subscribable<SchemaComponentRoot<T> | null>;
  componentChildren(): Subscribable<ComponentRoot[]>;
  componentChildren<T>(
    schema: Schema<T>,
  ): Subscribable<SchemaComponentRoot<T>[]>;
};

/**
 * Result of a schema-filtered lookup. `handle` is non-optional because the
 * walker only returns elements whose handle's doc parsed under the schema.
 */
export type SchemaComponentRoot<T> = ComponentRoot<T> & {
  handle: DocHandle<T>;
};

/**
 * A component's default export. Returns either nothing or a cleanup fn.
 *
 * The mount fn is `async` so authors can `await repo.find(...)`, dynamic
 * imports, etc. before they touch the element. The registry handles
 * races (element removed mid-mount, source hot-reloaded mid-mount,
 * `doc=` flipped mid-mount) by tracking a four-state lifecycle per
 * `Component`; if `unmount()` ran while the mount fn was in flight,
 * the returned cleanup runs immediately and is discarded rather than
 * installed.
 */
export type MountFn = (
  element: ComponentRoot,
) => Promise<(() => void) | void> | ((() => void) | void);
