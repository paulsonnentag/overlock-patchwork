export function findContext<T>(
  start: HTMLElement,
  predicate: (value: unknown) => value is T,
): T | undefined {
  let current: HTMLElement | null = start.parentElement
  while (current) {
    const value = (current as HTMLElement & { value?: unknown }).value
    if (predicate(value)) return value
    current = current.parentElement
  }
  return undefined
}
