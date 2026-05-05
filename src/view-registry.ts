import { type ModuleUpdatedEvent, type ModuleWatcher } from "./module-watcher";
import { TypedEventTarget } from "./typed-event-target";

export type MountFn = (
  element: HTMLElement
) => undefined | (() => void) | Promise<undefined | (() => void)>;

export type ViewRegistryOptions = {
  root: HTMLElement;
  moduleWatcher: ModuleWatcher;
};

export type ViewRegistryLoadedEvent = CustomEvent<{
  viewUrl: string;
  view: { name: string; mount: MountFn; [key: string]: unknown };
}>;

export type ViewRegistryUpdatedEvent = CustomEvent<{
  viewUrl: string;
  previous: { name: string; mount: MountFn; [key: string]: unknown };
  next: { name: string; mount: MountFn; [key: string]: unknown };
}>;

export type ViewRegistryRemovedEvent = CustomEvent<{
  viewUrl: string;
  name: string;
}>;

export type ViewRegistryEvent =
  | ViewRegistryLoadedEvent
  | ViewRegistryUpdatedEvent
  | ViewRegistryRemovedEvent;

export type ViewRegistryEventMap = {
  loaded: ViewRegistryLoadedEvent;
  updated: ViewRegistryUpdatedEvent;
  removed: ViewRegistryRemovedEvent;
};

export class ViewRegistry extends TypedEventTarget<ViewRegistryEventMap> {
  readonly #root: HTMLElement;
  readonly #moduleWatcher: ModuleWatcher;

  readonly #mountFnByViewName = new Map<string, MountFn>();
  readonly #mountFnByElement = new WeakMap<HTMLElement, MountFn>();
  readonly #unmountByElement = new WeakMap<HTMLElement, () => void>();
  readonly #nameByManifestUrl = new Map<string, string>();
  readonly #abort = new AbortController();

  #observer: MutationObserver;

  constructor({ root, moduleWatcher }: ViewRegistryOptions) {
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

  async registerView(url: string): Promise<string> {
    const cached = this.#nameByManifestUrl.get(url);
    if (cached) return cached;

    const module = await this.#moduleWatcher.load(url);
    const mount = (module.module as { default?: MountFn }).default;
    if (typeof mount !== "function") {
      throw new Error(
        `[overlock-patchwork] manifest "${url}" has no default-export mount fn`
      );
    }
    this.#nameByManifestUrl.set(url, module.name);
    this.#registerNamed(module.name, mount);
    return module.name;
  }

  #registerNamed(name: string, mount: MountFn): void {
    const tag = name.toLowerCase();

    this.#mountFnByViewName.set(tag, mount);
    this.#scanSubtree(this.#root, { matchTag: name });
  }

  #onModuleUpdated = (event: ModuleUpdatedEvent): void => {
    const { moduleUrl, next } = event.detail;
    if (!this.#nameByManifestUrl.has(moduleUrl)) return;
    const mount = (next.module as { default?: MountFn }).default;
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
    // when root matches a registered view mount it and return immediately
    // if root contains sub views they will be mounted once the mounted event is triggered on root
    const normalizedTagName = root.tagName.toLowerCase();
    if (
      (!opts?.matchTag || opts.matchTag == normalizedTagName) &&
      this.#mountFnByViewName.has(normalizedTagName)
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
    const mount = this.#mountFnByViewName.get(tag);
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

    el.replaceChildren();
    el.dispatchEvent(new CustomEvent("patchwork:unmounted", { bubbles: true }));
  }
}
