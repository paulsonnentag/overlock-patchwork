import type { StandardSchemaV1 } from "@standard-schema/spec";

import { type ModuleUpdatedEvent, type ModuleWatcher } from "./module-watcher";
import { TypedEventTarget } from "./typed-event-target";

export type MountFn = (
  element: HTMLElement
) => undefined | (() => void) | Promise<undefined | (() => void)>;

export type ComponentRegistryOptions = {
  root: HTMLElement;
  moduleWatcher: ModuleWatcher;
};

export type RegistryComponent = {
  name: string;
  mount: MountFn;
  schema?: StandardSchemaV1;
  [key: string]: unknown;
};

export type ComponentRegistryLoadedEvent = CustomEvent<{
  componentUrl: string;
  component: RegistryComponent;
}>;

export type ComponentRegistryUpdatedEvent = CustomEvent<{
  componentUrl: string;
  previous: RegistryComponent;
  next: RegistryComponent;
}>;

export type ComponentRegistryRemovedEvent = CustomEvent<{
  componentUrl: string;
  name: string;
}>;

export type ComponentRegistryEvent =
  | ComponentRegistryLoadedEvent
  | ComponentRegistryUpdatedEvent
  | ComponentRegistryRemovedEvent;

export type ComponentRegistryEventMap = {
  loaded: ComponentRegistryLoadedEvent;
  updated: ComponentRegistryUpdatedEvent;
  removed: ComponentRegistryRemovedEvent;
};

export class ComponentRegistry extends TypedEventTarget<ComponentRegistryEventMap> {
  readonly #root: HTMLElement;
  readonly #moduleWatcher: ModuleWatcher;

  readonly #mountFnByComponentName = new Map<string, MountFn>();
  readonly #mountFnByElement = new WeakMap<HTMLElement, MountFn>();
  readonly #unmountByElement = new WeakMap<HTMLElement, () => void>();
  readonly #nameByComponentUrl = new Map<string, string>();
  readonly #abort = new AbortController();

  #observer: MutationObserver;

  constructor({ root, moduleWatcher }: ComponentRegistryOptions) {
    super();
    this.#root = root;
    this.#moduleWatcher = moduleWatcher;

    const signal = this.#abort.signal;
    this.#root.addEventListener("patchwork:mounted", this.#onMounted, {
      signal,
    });
    this.#moduleWatcher.addEventListener("updated", this.#onModuleUpdated, {
      signal,
    });

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

  async registerComponent(url: string): Promise<string> {
    const cached = this.#nameByComponentUrl.get(url);
    if (cached) return cached;

    const loaded = await this.#moduleWatcher.load(url);
    const mount = (loaded.exports as { default?: MountFn }).default;
    if (typeof mount !== "function") {
      throw new Error(
        `[overlock-patchwork] component "${url}" has no default-export mount fn`
      );
    }
    this.#nameByComponentUrl.set(url, loaded.name);
    this.#registerNamed(loaded.name, mount);
    return loaded.name;
  }

  #registerNamed(name: string, mount: MountFn): void {
    const tag = name.toLowerCase();

    this.#mountFnByComponentName.set(tag, mount);
    this.#scanSubtree(this.#root, { matchTag: name });
  }

  #onModuleUpdated = (event: ModuleUpdatedEvent): void => {
    const { moduleUrl, next } = event.detail;
    if (!this.#nameByComponentUrl.has(moduleUrl)) return;
    const mount = (next.exports as { default?: MountFn }).default;
    if (typeof mount !== "function") return;
    this.#registerNamed(next.name, mount);
  };

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

  #scanSubtree(root: HTMLElement, opts?: { matchTag: string }): void {
    // when root matches a registered component mount it and return immediately
    // if root contains sub components they will be mounted once the mounted event is triggered on root
    const normalizedTagName = root.tagName.toLowerCase();
    if (
      (!opts?.matchTag || opts.matchTag == normalizedTagName) &&
      this.#mountFnByComponentName.has(normalizedTagName)
    ) {
      this.#tryMount(root);
      return;
    }

    // when root is just a regular html element we can immediately mount the children
    for (const child of root.children) {
      if (child instanceof HTMLElement) this.#scanSubtree(child, opts);
    }
  }

  #tryMount(el: HTMLElement): Promise<void> | undefined {
    if (this.#abort.signal.aborted) return;

    const tag = el.tagName.toLowerCase();
    const mount = this.#mountFnByComponentName.get(tag);
    if (!mount) return;

    if (this.#mountFnByElement.get(el) === mount) return Promise.resolve();

    const previous = this.#unmountByElement.get(el);
    if (previous) {
      previous();
      this.#unmountByElement.delete(el);
    }

    this.#mountFnByElement.set(el, mount);

    return Promise.resolve(mount(el)).then((unmount) => {
      if (
        this.#abort.signal.aborted ||
        this.#mountFnByElement.get(el) !== mount
      ) {
        if (unmount) unmount();
        return;
      }
      if (unmount) this.#unmountByElement.set(el, unmount);
      el.dispatchEvent(new CustomEvent("patchwork:mounted", { bubbles: true }));
    });
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
    this.#mountFnByElement.delete(el);
    el.dispatchEvent(new CustomEvent("patchwork:unmounted", { bubbles: true }));
  }
}
