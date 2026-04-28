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
