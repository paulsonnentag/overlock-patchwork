import type { Mount, PatchworkElement } from "./types"

export type ContextElement<T = unknown> = PatchworkElement & {
  value: T
}

export function defineContext<T>(value: T): Mount {
  return (element) => {
    Object.defineProperty(element, "value", {
      value,
      configurable: true,
    })
    return undefined
  }
}
