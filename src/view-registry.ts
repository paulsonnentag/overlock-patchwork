import { PATCHWORK_VIEW_TAG } from "./patchwork-view-element";
import { isView, mountView, unmountView, type MountFn } from "./view";
import type { LoadedPlugin, PluginRegistry } from "./plugin-registry";

export type ViewRegistryOptions = {
  root: HTMLElement;
  pluginRegistry: PluginRegistry;
};

/**
 * One mount root. Owns the view tag-name table and a `MutationObserver`
 * over the root element. Per-element instance state lives in
 * `view.ts`'s module-private `views` map; the registry doesn't track
 * View instances itself — the element is the identity carrier.
 *
 * Plugin loading and HMR live in `PluginRegistry`. This class consumes
 * its `load(url)` API for bootstrap and listens on the `updated`
 * event for HMR. It validates that loaded plugins are view-shaped
 * (`module.default` is the mount fn) — that's the kind-specific layer
 * on top of the generic plugin runtime.
 *
 * `<patchwork-view src="automerge:.../<name>.json">` is the bootstrap
 * tag: the registry recognizes it, asks the plugin registry for the
 * referenced plugin, registers `plugin.name` as a view, replaces the
 * `<patchwork-view>` element with `<plugin.name>` (carrying over `doc`
 * only and the children), and calls `mountView` against the new
 * element.
 *
 * Mounting is **top-down**: the registry walks subtrees stopping at
 * view boundaries (`<patchwork-view>` or any claimed view). Each view
 * waits for its closest ancestor view's `mounted` promise before
 * resolving its own context. After a view's mount fn completes
 * successfully the registry cascades into its now-static children and
 * processes them the same way, so descendants always observe a
 * fully-settled ancestor.
 *
 * On HMR (delivered via `pluginRegistry.addEventListener("updated",
 * …)`) the registry updates the name table — handling rename +
 * collision — and rebuilds every mounted instance under the previous
 * tag name.
 *
 * No namespaces yet: a name collision throws. Tears everything down
 * on `destroy()`.
 */
export class ViewRegistry {
  readonly #root: HTMLElement;
  readonly #pluginRegistry: PluginRegistry;

  // tag name -> mount fn. Throws on collision.
  readonly #viewsByTag = new Map<string, MountFn>();

  // Tracks which <patchwork-view> elements have already been claimed by
  // a bootstrap, so a remove + re-add cycle on the same node doesn't
  // kick off a duplicate load.
  readonly #claimedViews = new WeakSet<Element>();

  // Elements whose `doc=` flipped this tick. Drained on a microtask so
  // multiple synchronous attribute writes (e.g. a context-provider running
  // through several values in one Solid effect) coalesce into a single
  // rebuild that reads the *final* attribute value. Keyed by element so
  // a rebuild that swaps the element identity (HMR or doc-rebuild) leaves
  // the stale old element in the set; the flush filters it out via
  // `isView` and operates only on the current live element.
  readonly #pendingRebuilds = new Set<HTMLElement>();
  #rebuildScheduled = false;

  // One AbortController for every external listener the registry
  // installs (currently the plugin-registry "updated" subscription).
  // `destroy()` aborts it once.
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
    // Walk the root subtree and tear down every claimed element. The
    // element-keyed `views` map is the source of truth; `unmountView`
    // is a no-op on anything we walk that isn't a view.
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

  /**
   * `doc=` changed on an element we care about. Three cases:
   *
   * 1. `<patchwork-view>` pre-bootstrap — let the in-flight (or future)
   *    bootstrap pick up the new value when it reads the attribute.
   * 2. Mounted view — schedule a rebuild on the next microtask. The
   *    rebuild path swaps the element so `mountView` reads the fresh
   *    `doc=` from scratch and resolves the new handle.
   * 3. Anything else — ignore.
   *
   * The rebuild is microtask-batched so a series of synchronous `doc=`
   * writes in the same tick coalesce into one rebuild that reads the
   * final attribute value. Without batching, a context-provider that
   * iterates through three intermediate URLs in one effect would
   * tear down and re-mount the same descendant three times.
   */
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
      // Skip if the element was unmounted (or rebuilt — which counts
      // as unmounted) between the attribute change and this flush.
      if (!isView(el)) continue;
      const mountFn = this.#viewsByTag.get(el.localName);
      if (!mountFn) continue;
      this.#rebuildInstance(el, el.localName, mountFn);
    }
  }

  /**
   * The 5-step `<patchwork-view>` handoff:
   *   1. ask the plugin registry to load the URL
   *   2. extract the mount fn from the loaded module
   *   3. register `plugin.name` → mountFn (throw on collision)
   *   4. replace `<patchwork-view>` with `<plugin.name>` (keep `doc=`
   *      and children only)
   *   5. mount and cascade
   *
   * The mount fn's per-element doc context (read `doc=`, await
   * `repo.find(url)`, stamp `el.handle`) is resolved inside `mountView`
   * itself before the user's mount fn runs.
   */
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

  /**
   * HMR delivered by the plugin registry's `updated` event. Skips
   * no-op updates (same name + same module reference — defensive
   * against spurious change events; the plugin registry doesn't
   * pre-dedup), checks for tag-name collisions on rename, swaps the
   * name table, and rebuilds every element currently mounted under
   * the previous tag name (found by walking the registry's root
   * looking for the tag, filtered by `isView`).
   *
   * Plugins whose module isn't view-shaped (no default-export
   * function) are ignored: this registry only consumes the view kind.
   * Other plugin kinds will surface their own consumers.
   *
   * Element identity is intentionally lost on reload — see
   * [`docs/lifecycle.md`](../docs/lifecycle.md).
   */
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
    // Only consume view-shaped plugins. If the previous load wasn't a
    // view, there's nothing in our name table to update; if the new
    // load isn't a view, we drop the old entry.
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
      // Tear down without remount: the new module isn't view-shaped,
      // so nothing to mount under the new name. Run cleanup on existing
      // instances and drop them.
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

  /**
   * Tear down the old element fully and recreate it under the new tag name.
   * Runs cleanup, copies the current attrs and children to the new element,
   * inserts in place of the old, then mounts. Element identity is lost on
   * purpose — that's the chosen HMR semantics; it's also reused for
   * `doc=` attribute changes so the rebuild path always re-resolves the
   * handle from scratch.
   *
   * Order of operations matters: `unmountView(oldEl)` runs the old
   * cleanup *before* `mountView(newEl)` claims the new element and
   * starts the next lifecycle, so cleanup-before-new-mount ordering is
   * preserved. The MO will later see `removedNodes: [oldEl]` and call
   * `unmountView(oldEl)` again — that's a no-op because the entry is
   * already gone from the views map.
   */
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

  /**
   * Mount `el` and, once its mount fn resolves successfully, walk its
   * (now-static) children and process each through `#handleElement`.
   * The walk uses the same stop-at-view-boundary rule as the initial
   * scan so descendant views go through their own deferred-cascade
   * path. Failure suppresses the cascade — descendants in this subtree
   * stay un-mounted and the failure is already logged inside
   * `mount()`.
   */
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

  /**
   * Snapshot of every element under `root` that currently has tag `tag`
   * and is a claimed view. Snapshotted up-front because the HMR
   * rebuild loop mutates the DOM as it goes.
   */
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

/**
 * Replace `oldEl` with a fresh element of `newTag`, copying only
 * `doc=` and the children. The view contract documents `<patchwork-view>`
 * as carrying just `src` and `doc`; `src` is consumed by the
 * bootstrap and `doc` is handed off to the swapped element so
 * `resolveContext` picks it up. Anything else on `<patchwork-view>` is
 * not part of the contract and would silently leak through to the
 * user's tag if forwarded.
 */
function swapTag(oldEl: HTMLElement, newTag: string): HTMLElement {
  const parent = oldEl.parentNode;
  const newEl = oldEl.ownerDocument.createElement(newTag);
  const doc = oldEl.getAttribute("doc");
  if (doc !== null) newEl.setAttribute("doc", doc);
  while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
  if (parent) parent.replaceChild(newEl, oldEl);
  return newEl;
}

/**
 * A plugin is view-shaped if its module default-exports a function.
 * Other plugin kinds (datatypes, tools, etc. — when those land) will
 * have different shape requirements; this registry only consumes the
 * view kind.
 */
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

/**
 * Walk `root` and call `fn` on every element, stopping at view
 * boundaries: `<patchwork-view>` (any state) and any element claimed
 * by `mountView`. Descendants of view boundaries are *not* visited —
 * they're left to the deferred cascade that runs after the view's
 * mount fn settles, so the parent always observes its children in
 * their pristine pre-mount state.
 */
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
