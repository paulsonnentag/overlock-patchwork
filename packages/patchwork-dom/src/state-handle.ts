export class StateHandle<T> extends EventTarget {
  #current: T
  readonly #equals: (a: T, b: T) => boolean

  constructor(initial: T, equals: (a: T, b: T) => boolean = Object.is) {
    super()
    this.#current = initial
    this.#equals = equals
  }

  get value(): T {
    return this.#current
  }

  change(next: T): void {
    if (this.#equals(next, this.#current)) return
    this.#current = next
    this.dispatchEvent(new Event("change"))
  }
}

export function shallowArrayEquals<T>(
  a: readonly T[],
  b: readonly T[],
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}
