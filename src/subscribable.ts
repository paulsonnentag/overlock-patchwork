/**
 * `Subscribable<T>` is the framework's reactive primitive: a value that
 * can be observed for changes. Used by `ComponentRoot`'s ancestor and
 * descendant lookup methods so consumers can subscribe to "the closest
 * matching ancestor" or "my child components" and react when the answer
 * changes.
 *
 * `el.handle` and `el.repo` are *not* `Subscribable`s — they keep their
 * stable references and rely on their own change-event channels
 * (Automerge `change` events on the wrapped handle, in-place mutation
 * of `BranchableRepo`).
 *
 * Contract:
 *
 * - `value()` returns the current value synchronously.
 * - `subscribe(fn)` registers a listener; `fn` is invoked synchronously
 *   with the current value when subscribing, then again on every
 *   subsequent change. Returns an unsubscribe function.
 */
export type Subscribable<T> = {
  value(): T;
  subscribe(fn: (value: T) => void): () => void;
};

/**
 * Default `Subscribable<T>` implementation. Holds a single value and
 * fans `change(next)` calls out to all subscribers when `next` differs
 * from the current value under `Object.is`.
 *
 * `change` is public so framework code can drive updates; consumers
 * receive the read-only `Subscribable<T>` view via `ComponentRoot`.
 */
export class BasicSubscribable<T> implements Subscribable<T> {
  readonly #subs = new Set<(value: T) => void>();
  #current: T;

  constructor(initial: T) {
    this.#current = initial;
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
    if (Object.is(next, this.#current)) return;
    this.#current = next;
    for (const fn of this.#subs) fn(next);
  }
}
