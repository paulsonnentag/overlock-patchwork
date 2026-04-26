import type { Component } from "./component.js";

/**
 * Singleton element to component lookup. The registry writes to it on mount
 * and unmount; ancestor walks (`closestComponent` / `ancestorComponent` in
 * `ancestor-lookup.ts`) read from it. Keyed via `WeakMap` so it never keeps
 * DOM nodes alive on its own — Components unregister themselves on
 * `unmount()`, and any leftover entries for elements that get GCd vanish
 * with them.
 *
 * The store is process-wide on purpose: two `ComponentRegistry` instances
 * over disjoint subtrees never see each other's elements; on overlapping
 * subtrees they would conflict, which is the same answer either way.
 */

const byElement = new WeakMap<Element, Component>();

export function register(el: Element, comp: Component): void {
  byElement.set(el, comp);
}

export function unregister(el: Element): void {
  byElement.delete(el);
}

export function lookup(el: Element): Component | undefined {
  return byElement.get(el);
}
