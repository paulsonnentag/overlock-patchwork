import { PATCHWORK_VIEW_TAG } from "./patchwork-view-element";
import { isView, mountView, unmountView, type MountFn } from "./view";
import type { LoadedPlugin, PluginRegistry } from "./plugin-registry";

export class ViewRegistry {
  readonly #root: HTMLElement;

  readonly #viewsByTag = new Map<string, MountFn>();
  readonly #mountedElementsByView = new Map<Element, Set<Element>>();
  readonly #unmountByElement = new WeakMap<Element, () => void>();
  
  readonly #abort = new AbortController();

  #observer: MutationObserver;

  constructor(root: HTMLElement) {
    this.#root = root;

    this.#observer = new MutationObserver(this.#handleMutations);
    this.#observer.observe(this.#root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["doc"],
    });

    this.#handleAddedElement(this.#root)
  }

  destroy(): void {
    this.#observer.disconnect();
    this.#abort.abort();

    this.#handleRemovedElement(this.#root)
  }

  registerView (name: string, mount: MountFn):  void {

    

  }


  #handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {  
        this.#handleAddedElement(node)
      }
    }
    for (const node of mutation.removedNodes) {
      if (node instanceof Element) {
        this.#handleRemovedElement(node);
      }
    }
  }
  

  #handleAddedElement (element: Element) {

    for (const {parentView, element} of ) {

    }
  
  }

  #handleRemovedElement (element: Element) {

  }

  #walkElements (root: HTMLElement) {
    const queue: { element: Element; parent: Element | null }[] = [
      { element: root, parent: null }
    ];
  
    while (queue.length) {
      const entry = queue.shift()!;
      yield entry;
  
      const nextParent = isParent(entry.node) ? entry.node : entry.parent;
  
      for (const child of entry.node.children) {
        queue.push({ node: child, parent: nextParent });
      }
    }

  }
  
}
