import type { Repo } from "@automerge/automerge-repo";

import {
  readValue,
  type ElementWithHandle,
  type ElementWithValue,
} from "./types";

export type ComponentRegistry = {
  register(componentUrl: string): Promise<string>;
};

export function findElement<T extends HTMLElement>(
  start: HTMLElement,
  predicate: (element: HTMLElement) => element is T
): T | undefined;
export function findElement(
  start: HTMLElement,
  predicate: (element: HTMLElement) => boolean
): HTMLElement | undefined;
export function findElement(
  start: HTMLElement,
  predicate: (element: HTMLElement) => boolean
): HTMLElement | undefined {
  let current: HTMLElement | null = start.parentElement;
  while (current) {
    if (predicate(current)) return current;
    current = current.parentElement;
  }
  return undefined;
}

// `E` captures the predicate's narrowed element type directly so TS can
// infer it; the handle type is then projected via indexed access. Keeping
// `T` inside the intersection breaks inference and falls back to
// `unknown` at the call site.
export function findHandle<E extends ElementWithHandle<unknown>>(
  start: HTMLElement,
  predicate: (element: HTMLElement) => element is E
): E["handle"] | undefined {
  return findElement(start, predicate)?.handle;
}

export function findValue<E extends ElementWithValue<unknown>>(
  start: HTMLElement,
  predicate: (element: HTMLElement) => element is E
): E["value"] | undefined {
  return findElement(start, predicate)?.value;
}

export function getRepo(element: HTMLElement): Repo {
  const repo = findValue(element, hasRepoProvider);
  if (!repo) throw new Error("getRepo: no <repo-provider> ancestor");
  return repo;
}

export function getComponentRegistry(element: HTMLElement): ComponentRegistry {
  const componentRegistry = findValue(element, hasComponentRegistryProvider);
  if (!componentRegistry) {
    throw new Error(
      "getComponentRegistry: no <component-registry-provider> ancestor"
    );
  }
  return componentRegistry;
}

export function isRepoProvider(value: unknown): value is Repo {
  return (
    typeof value === "object" &&
    value !== null &&
    "find" in value &&
    typeof value.find === "function" &&
    "create" in value &&
    typeof value.create === "function"
  );
}

export function isComponentRegistryProvider(
  value: unknown
): value is ComponentRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    "register" in value &&
    typeof value.register === "function"
  );
}

function hasRepoProvider(el: HTMLElement): el is ElementWithValue<Repo> {
  return isRepoProvider(readValue(el));
}

function hasComponentRegistryProvider(
  el: HTMLElement
): el is ElementWithValue<ComponentRegistry> {
  return isComponentRegistryProvider(readValue(el));
}
