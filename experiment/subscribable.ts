/**
 * Standalone copy of the framework's `Subscribable<T>` primitive, scoped
 * to the experiment so the prototype has zero dependencies on the rest
 * of the codebase. Same contract as `src/subscribable.ts`: `value()`
 * returns the current value synchronously; `subscribe(fn)` invokes `fn`
 * synchronously with the current value, then again on every subsequent
 * change, returning an unsubscribe.
 *
 * The constructor takes an optional `equals` callback so list-shaped
 * views can dedup on shallow array equality instead of identity.
 */
export type Subscribable<T> = {
  value(): T;
  subscribe(fn: (value: T) => void): () => void;
};

export class BasicSubscribable<T> implements Subscribable<T> {
  readonly #subs = new Set<(value: T) => void>();
  #current: T;
  readonly #equals: (a: T, b: T) => boolean;

  constructor(initial: T, equals: (a: T, b: T) => boolean = Object.is) {
    this.#current = initial;
    this.#equals = equals;
  }

  value(): T {
    return this.#current;
  }

  subscribe(fn: (value: T) => void): () => void {
    this.#subs.add(fn);
    fn(this.#current);
    return () => {
      this.#subs.delete(fn);
    };
  }

  change(next: T): void {
    if (this.#equals(next, this.#current)) return;
    this.#current = next;
    for (const fn of this.#subs) fn(next);
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
