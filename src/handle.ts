/**
 * Framework reactive primitive. Shaped to match the subscribable surface
 * used by the rest of the runtime: extends `EventTarget`, exposes a
 * synchronous `value` getter, and dispatches a `change` event whenever
 * `change(next)` lands a new value.
 *
 * `Handle` does *not* fire on subscribe — consumers wire up the same
 * way they would for any `EventTarget` (`h.addEventListener("change",
 * fn)`) and read the initial value with `h.value` if they care about
 * it. For batch teardown, pair `addEventListener` with an
 * `AbortSignal`: `h.addEventListener("change", fn, { signal })` — one
 * `controller.abort()` then unwires every listener registered with
 * that signal.
 *
 * The `equals` callback dedups `change(next)` against the current
 * value. Defaults to `Object.is` for scalars and references; pass
 * `shallowArrayEquals` for list-shaped views so structural rebuilds
 * that produce a new but element-wise-equal array don't fan out a
 * spurious notification.
 *
 * The event payload is empty — listeners read `e.target.value` (or
 * close over the handle reference). That matches the context shape
 * (`defineContext`-installed `value` getter + `change` event) and any
 * other source/sink in the framework.
 */
export class Handle<T> extends EventTarget {
  #current: T;
  readonly #equals: (a: T, b: T) => boolean;

  constructor(initial: T, equals: (a: T, b: T) => boolean = Object.is) {
    super();
    this.#current = initial;
    this.#equals = equals;
  }

  get value(): T {
    return this.#current;
  }

  change(next: T): void {
    if (this.#equals(next, this.#current)) return;
    this.#current = next;
    this.dispatchEvent(new Event("change"));
  }
}

export function shallowArrayEquals<T>(
  a: readonly T[],
  b: readonly T[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}
