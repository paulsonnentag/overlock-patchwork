import type { Repo } from "@automerge/automerge-repo"
import type { StandardSchemaV1 } from "@standard-schema/spec"

type Registry = { registerComponent(componentUrl: string): Promise<string> }

export type LoadedModule = {
  name: string
  module: string
  exports: unknown
  schema?: StandardSchemaV1
}

export type ModuleWatcher = {
  load(url: string): Promise<LoadedModule>
}

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

export function getComponentRegistry(element: HTMLElement): Registry {
  const registry = findValue(element, hasRegistryProvider)
  if (!registry) {
    throw new Error(
      "getComponentRegistry: no <component-registry-provider> ancestor",
    )
  }
  return registry
}

export function getModuleWatcher(element: HTMLElement): ModuleWatcher {
  const watcher = findValue(element, hasModuleWatcher)
  if (!watcher) {
    throw new Error(
      "getModuleWatcher: no <module-watcher-provider> ancestor",
    )
  }
  return watcher
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
    "registerComponent" in value &&
    typeof (value as { registerComponent?: unknown }).registerComponent ===
      "function"
  )
}

export function isModuleWatcher(value: unknown): value is ModuleWatcher {
  return (
    typeof value === "object" &&
    value !== null &&
    "load" in value &&
    typeof (value as { load?: unknown }).load === "function"
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

function hasModuleWatcher(
  el: HTMLElement,
): el is HTMLElement & { value: ModuleWatcher } {
  return isModuleWatcher((el as HTMLElement & { value?: unknown }).value)
}
