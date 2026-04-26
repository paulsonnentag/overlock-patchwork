import type { DocHandle } from "@automerge/automerge-repo/slim";

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
 *   (absent when the host element had no `doc=`).
 * - `closestComponent(schema)` — walk self → ancestors; return the first
 *   element whose handle's doc parses under `schema`. Returns `null` if
 *   no ancestor matches.
 * - `ancestorComponent()` — walk parent → ancestors; return the first
 *   registered component, regardless of handle. Returns `null` if none.
 * - `ancestorComponent(schema)` — same walk, but apply the parse filter.
 *
 * Lookups run synchronously against the current state of `componentStore`.
 * Note that `el.handle` is set asynchronously by the registry's
 * `#resolveContext` step, so a child mount fn that races a parent's
 * doc-resolution may briefly see an ancestor with no `handle` and skip it.
 * If you need an ancestor's handle, call the lookup from inside a reactive
 * scope (Solid effect, etc.) and let it re-run, or call it after the
 * relevant async work has settled.
 */
export type ComponentRoot<V = unknown> = HTMLElement & {
  handle?: DocHandle<V>;
  closestComponent<T>(schema: Schema<T>): SchemaComponentRoot<T> | null;
  ancestorComponent(): ComponentRoot | null;
  ancestorComponent<T>(schema: Schema<T>): SchemaComponentRoot<T> | null;
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
 * imports, etc. before they touch the element. The registry handles races
 * (element removed mid-mount, source hot-reloaded mid-mount) by tracking a
 * generation per `Component` and running any returned cleanup immediately
 * if the mount lost its race.
 */
export type MountFn = (
  element: ComponentRoot,
) => Promise<(() => void) | void> | ((() => void) | void);
