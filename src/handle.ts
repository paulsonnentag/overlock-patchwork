import EventEmitter from "eventemitter3";

/**
 * Framework reactive primitive. Shaped like Automerge's `DocHandle`:
 * extends `EventEmitter`, exposes a synchronous `value()` accessor, and
 * fires a `change` event whenever `change(next)` lands a new value.
 *
 * `Handle` does *not* fire on subscribe — consumers wire up the same
 * way they would for a `DocHandle` (`h.on("change", fn)`) and read the
 * initial value with `h.value()` if they care about it. That mirrors
 * the rest of the framework's listener idiom and matches Solid's
 * `createSignal(h.value()); h.on("change", setSignal)` pattern with no
 * special-case glue.
 *
 * The `equals` callback dedups `change(next)` against the current
 * value. Defaults to `Object.is` for scalars and references; pass
 * `shallowArrayEquals` for list-shaped views so structural rebuilds
 * that produce a new but element-wise-equal array don't fan out a
 * spurious notification.
 */
export type HandleEvents<T> = {
  change: (value: T) => void;
};

export class Handle<T> extends EventEmitter<HandleEvents<T>> {
  #current: T;
  readonly #equals: (a: T, b: T) => boolean;

  constructor(initial: T, equals: (a: T, b: T) => boolean = Object.is) {
    super();
    this.#current = initial;
    this.#equals = equals;
  }

  value(): T {
    return this.#current;
  }

  change(next: T): void {
    if (this.#equals(next, this.#current)) return;
    this.#current = next;
    this.emit("change", next);
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
