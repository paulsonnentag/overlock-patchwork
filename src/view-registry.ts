import { PATCHWORK_VIEW_TAG } from "./patchwork-view-element";
import { isView, mountView, unmountView, type MountFn } from "./view";
import type { LoadedPlugin, PluginRegistry } from "./plugin-registry";

export type ViewRegistryOptions = {
  root: HTMLElement;
  pluginRegistry: PluginRegistry;
};

export class ViewRegistry {
  readonly #root: HTMLElement;
  readonly #pluginRegistry: PluginRegistry;

  readonly #viewsByTag = new Map<string, MountFn>();
  readonly #claimedViews = new WeakSet<Element>();
  readonly #pendingRebuilds = new Set<HTMLElement>();
  #rebuildScheduled = false;
  readonly #abort = new AbortController();

  #observer: MutationObserver | null = null;

  constructor(options: ViewRegistryOptions) {
    this.#root = options.root;
    this.#pluginRegistry = options.pluginRegistry;

    this.#pluginRegistry.addEventListener("updated", this.#onPluginUpdate, {
      signal: this.#abort.signal,
    });
    this.#scanInitialTree();
    this.#observer = this.#startMutationObserver();
  }

  destroy(): void {
    if (this.#observer === null) return;
    this.#observer.disconnect();
    this.#observer = null;
    this.#pendingRebuilds.clear();
    this.#abort.abort();
    walkSubtree(this.#root, (el) => unmountView(el));
    this.#viewsByTag.clear();
  }

  #scanInitialTree(): void {
    walkStoppingAtViews(this.#root, (el) => this.#handleElement(el));
  }

  #startMutationObserver(): MutationObserver {
    const observer = new MutationObserver((records) => {
      for (const record of records) this.#handleMutation(record);
    });
    observer.observe(this.#root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["doc"],
    });
    return observer;
  }

  #handleMutation(record: MutationRecord): void {
    if (record.type === "attributes") {
      if (record.attributeName !== "doc") return;
      const target = record.target;
      if (!(target instanceof HTMLElement)) return;
      this.#handleDocAttributeChange(target);
      return;
    }
    for (const node of record.addedNodes) {
      if (node instanceof Element) {
        walkStoppingAtViews(node, (el) => this.#handleElement(el));
      }
    }
    for (const node of record.removedNodes) {
      if (!(node instanceof Element)) continue;
      // Still connected ⇒ the node was moved, not removed. Skip.
      if (node.isConnected) continue;
      walkSelfAndDescendants(node, (el) => {
        if (el.isConnected) return;
        unmountView(el);
      });
    }
  }

  #handleElement(el: Element): void {
    if (el.localName === PATCHWORK_VIEW_TAG) {
      const src = el.getAttribute("src");
      if (!src) return;
      if (this.#claimedViews.has(el)) return;
      this.#claimedViews.add(el);
      void this.#bootstrap(el as HTMLElement, src);
      return;
    }
    this.#mountIfRegistered(el);
  }

  #handleDocAttributeChange(el: HTMLElement): void {
    if (!isView(el)) return;
    this.#pendingRebuilds.add(el);
    if (this.#rebuildScheduled) return;
    this.#rebuildScheduled = true;
    queueMicrotask(() => this.#flushPendingRebuilds());
  }

  #flushPendingRebuilds(): void {
    this.#rebuildScheduled = false;
    if (this.#pendingRebuilds.size === 0) return;
    const pending = Array.from(this.#pendingRebuilds);
    this.#pendingRebuilds.clear();
    for (const el of pending) {
      // Skip stale entries: the element was unmounted (or rebuilt)
      // between the attribute change and this flush.
      if (!isView(el)) continue;
      const mountFn = this.#viewsByTag.get(el.localName);
      if (!mountFn) continue;
      this.#rebuildInstance(el, el.localName, mountFn);
    }
  }

  async #bootstrap(viewEl: HTMLElement, pluginUrl: string): Promise<void> {
    let loaded: LoadedPlugin;
    try {
      loaded = await this.#pluginRegistry.load(pluginUrl);
    } catch (err) {
      console.error(`[overlock-patchwork] failed to load ${pluginUrl}:`, err);
      return;
    }

    if (!viewEl.isConnected) return;

    let mountFn: MountFn;
    try {
      mountFn = extractMountFn(loaded);
    } catch (err) {
      console.error(`[overlock-patchwork] ${pluginUrl}:`, err);
      return;
    }

    this.#registerView(loaded.name, mountFn);

    const newEl = swapTag(viewEl, loaded.name);
    this.#mountAndCascade(newEl, mountFn);
  }

  #onPluginUpdate = (event: Event): void => {
    const { previous, next } = (
      event as CustomEvent<{
        pluginUrl: string;
        previous: LoadedPlugin;
        next: LoadedPlugin;
      }>
    ).detail;
    if (previous.name === next.name && previous.module === next.module) {
      return;
    }
    if (!isViewPlugin(previous)) return;

    let nextMountFn: MountFn | null = null;
    if (isViewPlugin(next)) {
      try {
        nextMountFn = extractMountFn(next);
      } catch (err) {
        console.error(
          `[overlock-patchwork] HMR for ${next.importUrl}:`,
          err,
        );
        nextMountFn = null;
      }
    }

    if (
      nextMountFn !== null &&
      previous.name !== next.name &&
      this.#viewsByTag.has(next.name)
    ) {
      throw new Error(
        `[overlock-patchwork] HMR collision: "${next.name}" is already registered`,
      );
    }

    const previousName = previous.name;
    const instances = this.#findMountedElements(this.#root, previousName);

    if (nextMountFn === null || next.name !== previousName) {
      this.#viewsByTag.delete(previousName);
    }
    if (nextMountFn !== null) {
      this.#viewsByTag.set(next.name, nextMountFn);
    }

    if (nextMountFn === null) {
      for (const el of instances) {
        unmountView(el);
        el.remove();
      }
      return;
    }

    for (const el of instances) {
      this.#rebuildInstance(el, next.name, nextMountFn);
    }
  };

  #registerView(name: string, mountFn: MountFn): void {
    const existing = this.#viewsByTag.get(name);
    if (existing && existing !== mountFn) {
      throw new Error(
        `[overlock-patchwork] view name collision: "${name}" is already registered`,
      );
    }
    this.#viewsByTag.set(name, mountFn);
  }

  #rebuildInstance(
    oldEl: HTMLElement,
    newName: string,
    mountFn: MountFn,
  ): void {
    const parent = oldEl.parentNode;
    unmountView(oldEl);
    if (!parent) return;

    const newEl = oldEl.ownerDocument.createElement(newName);
    for (const attr of Array.from(oldEl.attributes)) {
      newEl.setAttribute(attr.name, attr.value);
    }
    while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
    parent.replaceChild(newEl, oldEl);

    this.#mountAndCascade(newEl, mountFn);
  }

  #mountIfRegistered(el: Element): void {
    if (isView(el)) return;
    const mountFn = this.#viewsByTag.get(el.localName);
    if (!mountFn) return;
    this.#mountAndCascade(el as HTMLElement, mountFn);
  }

  #mountAndCascade(el: HTMLElement, mountFn: MountFn): void {
    const promise = mountView(el, mountFn);
    promise.then(
      () => {
        if (!el.isConnected) return;
        if (!isView(el)) return;
        this.#cascadeChildren(el);
      },
      () => {
        // Failure already logged in mount(); descendants stay dormant.
      },
    );
  }

  #cascadeChildren(el: HTMLElement): void {
    let child = el.firstElementChild;
    while (child) {
      const next = child.nextElementSibling;
      walkStoppingAtViews(child, (c) => this.#handleElement(c));
      child = next;
    }
  }

  // Snapshotted because the HMR rebuild loop mutates the DOM as it goes.
  #findMountedElements(root: HTMLElement, tag: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    walkSubtree(root, (el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.localName !== tag) return;
      if (!isView(el)) return;
      out.push(el);
    });
    return out;
  }
}

function swapTag(oldEl: HTMLElement, newTag: string): HTMLElement {
  const parent = oldEl.parentNode;
  const newEl = oldEl.ownerDocument.createElement(newTag);
  const doc = oldEl.getAttribute("doc");
  if (doc !== null) newEl.setAttribute("doc", doc);
  while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
  if (parent) parent.replaceChild(newEl, oldEl);
  return newEl;
}

function isViewPlugin(plugin: LoadedPlugin): boolean {
  const mod = plugin.module;
  return (
    typeof mod === "object" &&
    mod !== null &&
    typeof (mod as { default?: unknown }).default === "function"
  );
}

function extractMountFn(plugin: LoadedPlugin): MountFn {
  const mod = plugin.module;
  if (
    typeof mod !== "object" ||
    mod === null ||
    typeof (mod as { default?: unknown }).default !== "function"
  ) {
    throw new Error(
      `${plugin.importUrl} does not default-export a function`,
    );
  }
  return (mod as { default: MountFn }).default;
}

function walkStoppingAtViews(root: Element, fn: (el: Element) => void): void {
  fn(root);
  if (isViewBoundary(root)) return;
  let child = root.firstElementChild;
  while (child) {
    const next = child.nextElementSibling;
    walkStoppingAtViews(child, fn);
    child = next;
  }
}

function isViewBoundary(el: Element): boolean {
  return el.localName === PATCHWORK_VIEW_TAG || isView(el);
}

function walkSelfAndDescendants(
  el: Element,
  fn: (el: Element) => void,
): void {
  fn(el);
  walkSubtree(el, fn);
}

function walkSubtree(root: Element, fn: (el: Element) => void): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    fn(node);
    node = walker.nextNode() as Element | null;
  }
}
