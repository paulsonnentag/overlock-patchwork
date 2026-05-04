export type MountFn = (
  element: HTMLElement,
) => undefined | (() => void) | Promise<undefined | (() => void)>;

export type ViewElement = HTMLElement & {
  isPatchworkView: true;
};

export const MOUNTED_EVENT = "patchwork:mounted";
export const UNMOUNTED_EVENT = "patchwork:unmounted";

export class ViewRegistry {
  readonly #root: HTMLElement;

  readonly #mountFnByViewName = new Map<string, MountFn>();
  readonly #elementsByViewName = new Map<string, Set<HTMLElement>>();
  readonly #unmountByElement = new WeakMap<HTMLElement, () => void>();
  readonly #abort = new AbortController();

  #observer: MutationObserver;

  constructor(root: HTMLElement) {
    this.#root = root;

    const signal = this.#abort.signal;
    this.#root.addEventListener(MOUNTED_EVENT, this.#onMounted, { signal });

    this.#observer = new MutationObserver(this.#handleMutations);
    this.#observer.observe(this.#root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["doc"],
    });
  }

  destroy(): void {
    this.#observer.disconnect();
    this.#abort.abort();
    this.#unmountSubtree(this.#root);
    this.#root.replaceChildren();
  }

  registerView(name: string, mount: MountFn): void {
    const tag = name.toLowerCase();

    const existing = this.#elementsByViewName.get(tag);
    if (existing) {
      for (const element of [...existing]) this.#unmountElement(element);
    }

    this.#mountFnByViewName.set(tag, mount);

    if (this.#root.tagName.toLowerCase() === tag) {
      this.#tryMount(this.#root);
    }
    for (const el of this.#root.querySelectorAll(tag)) {
      if (el instanceof HTMLElement) this.#tryMount(el);
    }
  }

  #handleMutations = (mutations: MutationRecord[]): void => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) this.#scanSubtree(node);
      }
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLElement) this.#unmountSubtree(node);
      }
    }
  };

  #onMounted = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    for (const child of target.children) {
      if (child instanceof HTMLElement) this.#scanSubtree(child);
    }
  };

  #scanSubtree(root: HTMLElement): void {
    if (this.#mountFnByViewName.has(root.tagName.toLowerCase())) {
      this.#tryMount(root);
      return;
    }
    for (const child of root.children) {
      if (child instanceof HTMLElement) this.#scanSubtree(child);
    }
  }

  async #tryMount(el: HTMLElement): Promise<void> {
    if (this.#abort.signal.aborted) return;
    if (this.#unmountByElement.has(el)) return;

    const tag = el.tagName.toLowerCase();
    const mount = this.#mountFnByViewName.get(tag);
    if (!mount) return;

    let bucket = this.#elementsByViewName.get(tag);
    if (!bucket) {
      bucket = new Set();
      this.#elementsByViewName.set(tag, bucket);
    }
    bucket.add(el);

    const unmount = await mount(el);

    if (this.#abort.signal.aborted || !el.isConnected) {
      if (unmount) unmount();
      bucket.delete(el);
      if (bucket.size === 0) this.#elementsByViewName.delete(tag);
      return;
    }

    (el as ViewElement).isPatchworkView = true;
    if (unmount) this.#unmountByElement.set(el, unmount);

    el.dispatchEvent(new CustomEvent(MOUNTED_EVENT, { bubbles: true }));
  }

  #unmountSubtree(root: HTMLElement): void {
    if (this.#unmountByElement.has(root)) {
      this.#unmountElement(root);
    }
    for (const child of root.children) {
      if (child instanceof HTMLElement) this.#unmountSubtree(child);
    }
  }

  #unmountElement(el: HTMLElement): void {
    const unmount = this.#unmountByElement.get(el);
    if (unmount) {
      unmount();
      this.#unmountByElement.delete(el);
    }

    const tag = el.tagName.toLowerCase();
    const bucket = this.#elementsByViewName.get(tag);
    if (bucket) {
      bucket.delete(el);
      if (bucket.size === 0) this.#elementsByViewName.delete(tag);
    }

    el.dispatchEvent(new CustomEvent(UNMOUNTED_EVENT, { bubbles: true }));
  }
}
