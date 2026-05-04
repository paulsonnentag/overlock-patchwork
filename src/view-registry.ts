export type MountFn = (element: HTMLElement) => void | (() => void) | Promise<() => void>;

export type ViewElement = HTMLElement & {
  isPatchworkView: true
}
export class ViewRegistry {
  readonly #root: HTMLElement;

  readonly #mountFnByViewName = new Map<string, MountFn>();
  readonly #elementsByViewName = new Map<string, Set<HTMLElement>>();
  readonly #unmountByElement = new WeakMap<HTMLElement, () => void>();
  readonly #pendingElements = new Set<HTMLElement>();
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

    this.#mountViewsIn(root);
  }

  destroy(): void {
    this.#observer.disconnect();
    this.#abort.abort();

    this.#unmountViewsIn(this.#root);
  }

  registerView(name: string, mount: MountFn): void {
    // todo: right now we don't handle conflicts

    const matchingElements = this.#elementsByViewName.get(name);

    if (matchingElements) {
      for (const element of matchingElements) {
        const unmount = this.#unmountByElement.get(element);

        if (unmount) {
          unmount
        }
      }
    }

    this.#mountFnByViewName.set(name, mount);
    this.#mountViewsIn(this.#root);
  }

  #handleMutations = (mutations: MutationRecord[]): void => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          this.#mountViewsIn(node);
        }
      }
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLElement) {
          this.#unmountViewsIn(node);
        }
      }
    }
  };

  async #mountViewsIn(root: HTMLElement) {
    const alreadyMounted = this.#unmountByElement.has(root)
    if (alreadyMounted) {
      return
    }

    const mount = this.#mountFnByViewName.get(root.tagName);

    if (mount) {
      for (const element of this.#pendingElements) {
        if (element.contains(root)) {
          break;
        }
      }

      this.#pendingElements.add(root);

      const unmount = await mount(root);
      (root as ViewElement).isPatchworkView = true;
      if (unmount) {
        this.#unmountByElement.set(root, unmount);
      }

      this.#pendingElements.delete(root);
    }

    if (this.#abort.signal.aborted) {
      return
    }

    for (const child of root.children) {
      if (child instanceof HTMLElement) {
        this.#mountViewsIn(child);
      }
    }
  }

  #unmountViewsIn(root: HTMLElement) {
    const unmount = this.#unmountByElement.get(root);

    if (unmount) {
      unmount()
    }

    for (const child of root.children) {
      if (child instanceof HTMLElement) {
        this.#unmountViewsIn(child);
      }
    }
  }
}
