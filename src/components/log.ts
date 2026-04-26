/**
 * Cheap, single-prefix logger used across the component-registry stack.
 *
 * The registry's lifecycle is intentionally async (manifest fetch, doc
 * resolve, HMR rebuilds, attribute-driven rebuilds), and most bugs there
 * show up as "the wrong number of mounts/unmounts ran in the wrong order".
 * Tracing each lifecycle event with a stable prefix is the cheapest way
 * to make that visible. `console.log` (not `debug`) so the output is on
 * by default in browsers without flipping the log-level dropdown.
 */
export function log(...args: unknown[]): void {
  console.log("[overlock-patchwork]", ...args);
}
