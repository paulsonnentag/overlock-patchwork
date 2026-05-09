export type MountFn = (
  element: HTMLElement
) => undefined | (() => void) | Promise<undefined | (() => void)>;

export type ComponentRegistryOptions = {
  root: HTMLElement;
};

export class ComponentRegistry {
  readonly #root: HTMLElement;

  readonly #mountFnByComponentName = new Map<string, MountFn>();
  // Promise resolves to the unmount fn (or undefined if the mount didn't
  // return one). Stored synchronously when mount starts so a second
  // discovery path hitting the same element while mount is in flight can
  // dedupe on its identity.
  readonly #unmountByElement = new WeakMap<
    HTMLElement,
    Promise<(() => void) | undefined>
  >();
  readonly #nameByComponentUrl = new Map<string, Promise<string>>();
  readonly #abort = new AbortController();

  #observer: MutationObserver;

  constructor({ root }: ComponentRegistryOptions) {
    this.#root = root;

    const signal = this.#abort.signal;
    this.#root.addEventListener("patchwork:mounted", this.#onMounted, {
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

  register(url: string): Promise<string> {
    const cached = this.#nameByComponentUrl.get(url);
    if (cached) return cached;

    const name = (async (): Promise<string> => {
      const plugin = await fetch(`/${encodeURIComponent(url)}`)
        .then((r) => r.json())
        .catch(() => {
          throw new Error(`failed to load plugin: ${url}`);
        });

      if (!isValidComponentName(plugin.name)) {
        throw new Error(
          `${plugin.name} in ${url} is not a valid component name`
        );
      }

      if (this.#mountFnByComponentName.has(plugin.name)) {
        throw new Error(
          `component "${plugin.name}" is already registered (from a different url)`
        );
      }

      const moduleUrl = resolveModuleUrl(url, plugin.module);
      const module = await import(`/${encodeURIComponent(moduleUrl)}`).catch(
        () => {
          throw new Error(`failed to load module: ${moduleUrl}`);
        }
      );

      if (typeof module.default !== "function") {
        throw new Error(
          `component module ${plugin.module} is missing a default-export mount function`
        );
      }

      this.#mountFnByComponentName.set(plugin.name, module.default);
      this.#scanSubtree(this.#root, { matchTag: plugin.name });
      return plugin.name;
    })();

    this.#nameByComponentUrl.set(url, name);
    return name;
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

  #onMounted = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    for (const child of target.children) {
      if (child instanceof HTMLElement) this.#scanSubtree(child);
    }
  };

  #scanSubtree(root: HTMLElement, opts?: { matchTag: string }): void {
    const normalizedTagName = root.tagName.toLowerCase();
    if (
      (!opts?.matchTag || opts.matchTag === normalizedTagName) &&
      this.#mountFnByComponentName.has(normalizedTagName)
    ) {
      this.#tryMount(root);
      return;
    }

    for (const child of root.children) {
      if (child instanceof HTMLElement) this.#scanSubtree(child, opts);
    }
  }

  #tryMount(el: HTMLElement): Promise<unknown> | undefined {
    if (this.#abort.signal.aborted) return;
    const existing = this.#unmountByElement.get(el);
    if (existing) return existing;

    const tag = el.tagName.toLowerCase();
    const mount = this.#mountFnByComponentName.get(tag);
    if (!mount) return;

    const pending = Promise.resolve(mount(el)).then((unmount) => {
      if (
        !this.#abort.signal.aborted &&
        this.#unmountByElement.get(el) === pending
      ) {
        el.dispatchEvent(
          new CustomEvent("patchwork:mounted", { bubbles: true })
        );
      }
      return unmount;
    });
    this.#unmountByElement.set(el, pending);
    return pending;
  }

  #unmountSubtree(root: HTMLElement): void {
    if (this.#unmountByElement.has(root)) {
      this.#unmountElement(root);
    }
    for (const child of root.children) {
      if (child instanceof HTMLElement) this.#unmountSubtree(child);
    }
  }

  // Wait for the mount to resolve before running its cleanup so any side
  // effects it set up still get torn down. Releasing the map slot is
  // synchronous so an immediate re-add can claim a fresh entry.
  #unmountElement(el: HTMLElement): void {
    const pending = this.#unmountByElement.get(el);
    if (!pending) return;
    this.#unmountByElement.delete(el);
    void pending.then((unmount) => {
      if (unmount) unmount();
      el.dispatchEvent(
        new CustomEvent("patchwork:unmounted", { bubbles: true })
      );
    });
  }
}

function resolveModuleUrl(pluginUrl: string, modulePath: string): string {
  if (!pluginUrl.startsWith("automerge:")) {
    throw new Error(`expected automerge: plugin url, got ${pluginUrl}`);
  }
  const [docId, ...rest] = pluginUrl.slice("automerge:".length).split("/");
  const segments = rest.slice(0, -1);
  for (const part of modulePath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return `automerge:${docId}/${segments.join("/")}`;
}

function isValidComponentName(name: string): boolean {
  // component names must be valid custom element names
  // - must contain a hyphen
  // - cannot be one of the reserved names.
  // https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name
  return (
    /^[a-z][.0-9_a-z]*-[.0-9_a-z-]*$/.test(name) &&
    ![
      "annotation-xml",
      "color-profile",
      "font-face",
      "font-face-src",
      "font-face-uri",
      "font-face-format",
      "font-face-name",
      "missing-glyph",
    ].includes(name)
  );
}
