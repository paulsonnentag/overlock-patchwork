import { createSignal, onCleanup } from "https://esm.sh/solid-js@1.9.5";

/**
 * Bridge an overlock `Handle<T>` (the framework reactive primitive
 * returned by `closestView` / `ancestorView` / `childViews`) into a
 * Solid signal. The returned accessor reads the current value; updates
 * propagate via the handle's `change` event.
 *
 * Must be called inside a Solid reactive owner (component body,
 * `createRoot`, or `render`) — `onCleanup` only registers there. For
 * non-Solid consumers, subscribe with `handle.on("change", fn)` and
 * return the matching `off` from the mount fn.
 */
export function fromHandle(handle) {
  const [get, set] = createSignal(handle.value());
  const listener = (next) => set(() => next);
  handle.on("change", listener);
  onCleanup(() => handle.off("change", listener));
  return get;
}

/**
 * Walk up `<patchwork-context>` ancestors looking for the first one
 * whose `value` satisfies `predicate`. Returns the value, or `null`
 * if no matching context is in scope. Stops walking at any context
 * that doesn't match — callers wrap their lookups in stacked
 * contexts and rely on the walk to skip irrelevant ones (same shape
 * the framework uses for `el.repo` resolution in `src/view.ts`).
 *
 * Snapshot lookup. The matched value's *reference* doesn't refresh
 * later; for reactive reads on a doc handle's content, subscribe
 * with `makeDocumentProjection(handle)` once you've found it. Not
 * Solid-specific despite living next to `fromHandle`.
 */
export function findContextValue(element, predicate) {
  let cur = element;
  while (cur) {
    const ctx = cur.closest("patchwork-context");
    if (!ctx) return null;
    if (predicate(ctx.value)) return ctx.value;
    cur = ctx.parentElement;
  }
  return null;
}

/**
 * Convenience over `findContextValue` for the common case: a doc
 * handle whose doc carries `@patchwork.type === type`. Account,
 * folder, etc. are all keyed this way.
 */
export function findHandleByPatchworkType(element, type) {
  return findContextValue(element, (v) => {
    if (!v || typeof v.doc !== "function") return false;
    return v.doc()?.["@patchwork"]?.type === type;
  });
}
