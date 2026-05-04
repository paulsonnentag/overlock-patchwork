import type { Mount, ViewElement } from "./types"

export type ContextElement<T = unknown> = ViewElement & {
  value: T
}

export function defineContext<T>(value: T): Mount {
  return async (element) => {
    Object.defineProperty(element, "value", {
      value,
      configurable: true,
    })
    return null
  }
}
