import type { Repo } from "@automerge/automerge-repo"

type Registry = { registerView(manifestUrl: string): Promise<string> }

export function findElement<T extends HTMLElement>(
  start: HTMLElement,
  predicate: (element: HTMLElement) => element is T,
): T | undefined
export function findElement(
  start: HTMLElement,
  predicate: (element: HTMLElement) => boolean,
): HTMLElement | undefined
export function findElement(
  start: HTMLElement,
  predicate: (element: HTMLElement) => boolean,
): HTMLElement | undefined {
  let current: HTMLElement | null = start.parentElement
  while (current) {
    if (predicate(current)) return current
    current = current.parentElement
  }
  return undefined
}

export function findHandle<T>(
  start: HTMLElement,
  predicate: (element: HTMLElement) => element is HTMLElement & { handle: T },
): T | undefined {
  return findElement(start, predicate)?.handle
}

export function findValue<T>(
  start: HTMLElement,
  predicate: (element: HTMLElement) => element is HTMLElement & { value: T },
): T | undefined {
  return findElement(start, predicate)?.value
}

export function getRepo(element: HTMLElement): Repo {
  const repo = findValue(element, hasRepoProvider)
  if (!repo) throw new Error("getRepo: no <repo-provider> ancestor")
  return repo
}

export function getViewRegistry(element: HTMLElement): Registry {
  const registry = findValue(element, hasRegistryProvider)
  if (!registry) {
    throw new Error("getViewRegistry: no <view-registry-provider> ancestor")
  }
  return registry
}

export function isRepoProvider(value: unknown): value is Repo {
  return (
    typeof value === "object" &&
    value !== null &&
    "find" in value &&
    typeof (value as { find?: unknown }).find === "function" &&
    "create" in value &&
    typeof (value as { create?: unknown }).create === "function"
  )
}

export function isRegistryProvider(value: unknown): value is Registry {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerView" in value &&
    typeof (value as { registerView?: unknown }).registerView === "function"
  )
}

function hasRepoProvider(
  el: HTMLElement,
): el is HTMLElement & { value: Repo } {
  return isRepoProvider((el as HTMLElement & { value?: unknown }).value)
}

function hasRegistryProvider(
  el: HTMLElement,
): el is HTMLElement & { value: Registry } {
  return isRegistryProvider((el as HTMLElement & { value?: unknown }).value)
}
