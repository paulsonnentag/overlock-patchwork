import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";
import {
  findHandleInFolderHandle,
  type FolderDoc,
  type UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

import { BranchableRepo, type ForkOpts } from "../branchable-repo";
import { Component } from "./component";
import * as componentStore from "./component-store";
import type { ComponentManifest, ComponentRoot, MountFn } from "../types";

const BOOTSTRAP_TAG = "patchwork-view";
const REPO_TAG = "automerge-repo";
const SRC_ATTR = "src";
const DOC_ATTR = "doc";

/**
 * Autonomous custom element for `<patchwork-view>`. The only thing it adds
 * over a plain `HTMLElement` is `src` and `doc` accessors that reflect to
 * the attribute, so frameworks that property-assign on hyphenated tags
 * (Solid's `html` template, Lit, etc.) end up writing through
 * `setAttribute`. The existing MutationObserver-based bootstrap then reads
 * the attributes as usual.
 *
 * The constructor runs the standard "lazy property upgrade" dance for
 * `src` and `doc`: when an element is cloned out of a `<template>` (Solid
 * does this), the dynamic attribute writes happen *before* the prototype
 * has been swapped to `PatchworkView`, so they land as own data
 * properties on the element. After upgrade those own properties shadow
 * the prototype accessors and the setter never reflects to the attribute.
 * Reading + deleting + re-assigning here forces the value back through
 * our setter so the attribute shows up.
 *
 * Defined once at module load. Registry orchestration for actual components
 * (`my-counter`, `wall-clock`, ...) does NOT go through `customElements` —
 * those stay plain `document.createElement(name)` elements so HMR can
 * rebuild them freely without hitting the global one-shot ratchet.
 */
class PatchworkView extends HTMLElement {
  constructor() {
    super();
    upgradeProperty(this, "src");
    upgradeProperty(this, "doc");
  }
  get src(): string {
    return this.getAttribute(SRC_ATTR) ?? "";
  }
  set src(v: string) {
    this.setAttribute(SRC_ATTR, String(v ?? ""));
  }
  get doc(): string {
    return this.getAttribute(DOC_ATTR) ?? "";
  }
  set doc(v: string) {
    this.setAttribute(DOC_ATTR, String(v ?? ""));
  }
}

function upgradeProperty(el: HTMLElement, prop: string): void {
  if (!Object.prototype.hasOwnProperty.call(el, prop)) return;
  const value = (el as unknown as Record<string, unknown>)[prop];
  delete (el as unknown as Record<string, unknown>)[prop];
  (el as unknown as Record<string, unknown>)[prop] = value;
}

if (!customElements.get(BOOTSTRAP_TAG)) {
  customElements.define(BOOTSTRAP_TAG, PatchworkView);
}

/**
 * Scope marker for a `Repo` instance. Descendant `<patchwork-view>`s
 * resolve their `doc=` attribute against `closest("automerge-repo").repo`.
 *
 * The element holds a reference to the repo as a property (not an
 * attribute — repos aren't strings). The `ComponentRegistry` injects the
 * initial repo on discovery; it inherits from the closest enclosing
 * `<automerge-repo>` ancestor (if any), or falls back to the registry's
 * root repo.
 *
 * The element also exposes `checkout`/`fork`/`reset` mutators that swap
 * its `.repo` to a different `BranchableRepo` view of the underlying
 * `Repo`. After each swap, every component descendant that resolves
 * against this `<automerge-repo>` is rebuilt so its `doc=` re-resolves
 * through the new repo. The rebuild hook is set by the
 * `ComponentRegistry` (via `_rebuildDescendants`) the first time it sees
 * this element.
 */
class AutomergeRepoElement extends HTMLElement {
  repo: BranchableRepo | null = null;
  /** @internal */
  _rebuildDescendants: (() => void) | null = null;

  async checkout(branchDocUrl: AutomergeUrl): Promise<BranchableRepo> {
    if (!this.repo) {
      throw new Error("automerge-repo: cannot checkout before .repo is set");
    }
    this.repo = await this.repo.checkout(branchDocUrl);
    this._rebuildDescendants?.();
    return this.repo;
  }

  async fork(opts: ForkOpts = {}): Promise<BranchableRepo> {
    if (!this.repo) {
      throw new Error("automerge-repo: cannot fork before .repo is set");
    }
    this.repo = await this.repo.fork(opts);
    this._rebuildDescendants?.();
    return this.repo;
  }

  reset(): BranchableRepo {
    if (!this.repo) {
      throw new Error("automerge-repo: cannot reset before .repo is set");
    }
    this.repo = BranchableRepo.wrap(this.repo.repo);
    this._rebuildDescendants?.();
    return this.repo;
  }
}

if (!customElements.get(REPO_TAG)) {
  customElements.define(REPO_TAG, AutomergeRepoElement);
}

type AutomergeImport = (spec: string) => Promise<unknown>;

type LoadedComponent = {
  spec: string;
  parentFolderHandle: DocHandle<FolderDoc>;
  manifest: ComponentManifest;
  mountFn: MountFn;
  unsubscribe: () => void;
};

type Deps = {
  repo: BranchableRepo;
  automergeImport: AutomergeImport;
};

/**
 * One mount root. Owns its component name registry, an iterable set of
 * mounted components for HMR teardown, and a `MutationObserver` over the
 * root element. Tears them all down on `destroy()`.
 *
 * `<patchwork-view src="automerge:.../component.json">` is the bootstrap tag:
 * the registry recognizes it, fetches the referenced manifest + JS module
 * from the automerge graph, registers the manifest's `name` as a component,
 * replaces the `<patchwork-view>` element with `<name>` (carrying over
 * non-`src` attributes and children), and mounts the component's async
 * default export against the new element.
 *
 * The registry also subscribes to the manifest's parent folder document.
 * Pushwork propagates child updates upward, so any edit under the folder
 * triggers a `change` event there; on change the registry re-fetches the
 * manifest + module and rebuilds every mounted instance under the (possibly
 * renamed) tag.
 *
 * No namespaces yet: a name collision throws.
 */
export class ComponentRegistry {
  readonly #root: HTMLElement;
  readonly #repo: BranchableRepo;
  readonly #automergeImport: AutomergeImport;

  // name -> mount fn. Throws on collision.
  readonly #registry = new Map<string, MountFn>();

  // spec -> loaded record. One entry per unique manifest spec; multiple
  // <patchwork-view src="X"> share the same load and the same HMR sub.
  readonly #loaded = new Map<string, LoadedComponent>();
  readonly #loading = new Map<string, Promise<LoadedComponent>>();

  // Iterable set of mounted Components. Used by HMR teardown to find every
  // element currently mounted under a given tag, and by `destroy`.
  readonly #mounted = new Set<Component>();

  // Tracks which <patchwork-view> elements have already been claimed by a
  // bootstrap, so a remove + re-add cycle on the same node doesn't kick off
  // a duplicate load.
  readonly #bootstrapping = new WeakSet<Element>();

  #observer: MutationObserver | null = null;

  constructor(root: HTMLElement, deps: Deps) {
    this.#root = root;
    this.#repo = deps.repo;
    this.#automergeImport = deps.automergeImport;

    this.#forEachElementIn(root, (el) => this.#handleElement(el));

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (record.attributeName !== DOC_ATTR) continue;
          const target = record.target;
          if (!(target instanceof HTMLElement)) continue;
          this.#handleDocAttributeChange(target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            this.#forEachElement(node, (el) => this.#handleElement(el));
          }
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          // Still connected ⇒ the node was moved, not removed. Skip.
          if (node.isConnected) continue;
          this.#forEachElement(node, (el) => {
            if (el.isConnected) return;
            this.#unmountIfMounted(el);
          });
        }
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [DOC_ATTR],
    });
    this.#observer = observer;
  }

  destroy(): void {
    if (this.#observer === null) return;
    this.#observer.disconnect();
    this.#observer = null;
    for (const comp of Array.from(this.#mounted)) comp.unmount();
    this.#mounted.clear();
    for (const loaded of this.#loaded.values()) loaded.unsubscribe();
    this.#loaded.clear();
    this.#loading.clear();
    this.#registry.clear();
  }

  #handleElement(el: Element): void {
    if (el.localName === REPO_TAG) {
      // Inject the repo onto the marker element so descendants can do
      // `el.closest("automerge-repo").repo`. Tree order from the initial
      // walk and from MO addedNodes guarantees this runs before any
      // descendant <patchwork-view> bootstrap.
      //
      // Nested <automerge-repo>s inherit from the nearest enclosing
      // <automerge-repo>; only the outermost one falls back to the
      // registry's root repo. A repo already set on the element (e.g.
      // by user code that wants to seed a forked repo) is preserved.
      const repoEl = el as AutomergeRepoElement;
      if (!repoEl.repo) {
        const ancestor = el.parentElement?.closest(
          REPO_TAG,
        ) as AutomergeRepoElement | null;
        repoEl.repo = ancestor?.repo ?? this.#repo;
      }
      if (!repoEl._rebuildDescendants) {
        repoEl._rebuildDescendants = () =>
          this.#rebuildDescendantsOfRepoEl(repoEl);
      }
      return;
    }
    if (el.localName === BOOTSTRAP_TAG) {
      const src = el.getAttribute(SRC_ATTR);
      if (!src) return;
      if (this.#bootstrapping.has(el)) return;
      this.#bootstrapping.add(el);
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
   * 2. Mounted component — rebuild the instance under the same tag and
   *    mount fn. The rebuild path runs `#resolveContext` against the new
   *    element, which re-reads `doc=` and produces the fresh handle.
   * 3. Anything else — ignore.
   */
  #handleDocAttributeChange(el: HTMLElement): void {
    const comp = componentStore.lookup(el);
    if (!comp || !this.#mounted.has(comp)) return;
    this.#rebuildInstance(comp, comp.el.localName, comp.mountFn);
  }

  /**
   * The 4-step `<patchwork-view>` handoff:
   *   1. fetch component.json via the repo
   *   2. register manifest.name → mountFn (throw on collision)
   *   3. replace <patchwork-view> with <manifest.name> (keep non-src attrs + children)
   *   4. construct Component, run async mountFn against the new element
   *
   * If the element carries a `doc=` attribute, step 4 also resolves a
   * `DocHandle` against the closest `<automerge-repo>` ancestor and stamps
   * it onto the new element as `el.handle` before the user's mount fn
   * runs.
   *
   * The folder subscription that drives HMR is set up inside `#load`.
   */
  async #bootstrap(viewEl: HTMLElement, spec: string): Promise<void> {
    let loaded: LoadedComponent;
    try {
      loaded = await this.#ensureLoaded(spec);
    } catch (err) {
      console.error(`[overlock-patchwork] failed to load ${spec}:`, err);
      return;
    }

    if (!viewEl.isConnected) return;

    this.#registerComponent(loaded.manifest.name, loaded.mountFn);

    const newEl = swapTag(viewEl, loaded.manifest.name);
    this.#mountElement(newEl, loaded.mountFn);
  }

  /**
   * Resolve the per-element doc context: read the `doc=` attribute, find
   * the closest `<automerge-repo>` ancestor, await `repo.find(docUrl)`,
   * and stamp the resulting `DocHandle` onto the element as `el.handle`.
   *
   * Strict: a `doc=` attribute without an `<automerge-repo>` ancestor is
   * an error. No `doc=` attribute is fine and leaves `el.handle`
   * untouched.
   */
  async #resolveContext(el: HTMLElement): Promise<void> {
    const docUrl = el.getAttribute(DOC_ATTR);
    if (!docUrl) return;

    const repoEl = el.closest(REPO_TAG) as AutomergeRepoElement | null;
    if (!repoEl?.repo) {
      throw new Error(
        `[overlock-patchwork] <${el.localName} ${DOC_ATTR}="${docUrl}"> requires an <${REPO_TAG}> ancestor`,
      );
    }
    if (!isValidAutomergeUrl(docUrl)) {
      throw new Error(
        `[overlock-patchwork] ${DOC_ATTR} attribute is not a valid automerge URL: "${docUrl}"`,
      );
    }

    const handle = await repoEl.repo.find(docUrl);
    (el as ComponentRoot).handle = handle as DocHandle<unknown>;
  }

  #registerComponent(name: string, mountFn: MountFn): void {
    const existing = this.#registry.get(name);
    if (existing && existing !== mountFn) {
      throw new Error(
        `[overlock-patchwork] component name collision: "${name}" is already registered`,
      );
    }
    this.#registry.set(name, mountFn);
  }

  #ensureLoaded(spec: string): Promise<LoadedComponent> {
    const existing = this.#loaded.get(spec);
    if (existing) return Promise.resolve(existing);
    const inFlight = this.#loading.get(spec);
    if (inFlight) return inFlight;
    const promise = this.#load(spec)
      .then((loaded) => {
        this.#loaded.set(spec, loaded);
        this.#loading.delete(spec);
        return loaded;
      })
      .catch((err) => {
        this.#loading.delete(spec);
        throw err;
      });
    this.#loading.set(spec, promise);
    return promise;
  }

  async #load(spec: string): Promise<LoadedComponent> {
    const { rootUrl, path } = parseSpec(spec);
    const parts = splitPath(path);
    if (parts.length === 0) {
      throw new Error(
        `[overlock-patchwork] manifest spec must reference a file: ${spec}`,
      );
    }

    const rootHandle = await this.#repo.find<FolderDoc>(rootUrl);
    const parentParts = parts.slice(0, -1);
    const manifestName = parts[parts.length - 1];
    const parentFolderHandle =
      parentParts.length === 0
        ? rootHandle
        : ((await findHandleInFolderHandle<FolderDoc>(
            // findHandleInFolderHandle expects a raw `Repo`; module
            // resolution should never see branched docs.
            this.#repo.repo,
            rootHandle,
            parentParts,
          )) as DocHandle<FolderDoc> | undefined);
    if (!parentFolderHandle) {
      throw new Error(
        `[overlock-patchwork] could not resolve parent folder for ${spec}`,
      );
    }

    const { manifest, mountFn } = await this.#fetchManifestAndModule(
      spec,
      parentFolderHandle,
      manifestName,
    );

    const onChange = (): void => {
      void this.#hmrReload(spec);
    };
    parentFolderHandle.on("change", onChange);
    const unsubscribe = (): void => {
      parentFolderHandle.off("change", onChange);
    };

    return { spec, parentFolderHandle, manifest, mountFn, unsubscribe };
  }

  /**
   * HMR: the manifest's parent folder doc changed. Re-fetch manifest +
   * module, then for every Component currently mounted under the previous
   * tag name: tear it down (run cleanup), recreate a fresh element with the
   * new tag name, and mount the new mount fn against it.
   *
   * If the manifest's `name` changed, drop the old name from the registry
   * and check the new one for collision (point 8b).
   */
  async #hmrReload(spec: string): Promise<void> {
    const old = this.#loaded.get(spec);
    if (!old) return;

    const { path } = parseSpec(spec);
    const parts = splitPath(path);
    const manifestName = parts[parts.length - 1];

    const fresh = await this.#fetchManifestAndModule(
      spec,
      old.parentFolderHandle,
      manifestName,
    );

    // No-op if the source is byte-identical (same mount fn would be a
    // pinned-cache hit — unlikely after a folder change — but defending
    // against spurious change events is cheap).
    if (
      fresh.manifest.name === old.manifest.name &&
      fresh.mountFn === old.mountFn
    ) {
      return;
    }

    if (
      fresh.manifest.name !== old.manifest.name &&
      this.#registry.has(fresh.manifest.name)
    ) {
      throw new Error(
        `[overlock-patchwork] HMR collision: ${spec} renamed to "${fresh.manifest.name}", which is already registered`,
      );
    }

    const previousName = old.manifest.name;
    const instances = Array.from(this.#mounted).filter(
      (comp) => comp.el.localName === previousName,
    );

    if (fresh.manifest.name !== previousName) {
      this.#registry.delete(previousName);
    }
    this.#registry.set(fresh.manifest.name, fresh.mountFn);
    old.manifest = fresh.manifest;
    old.mountFn = fresh.mountFn;

    for (const comp of instances) {
      this.#rebuildInstance(comp, fresh.manifest.name, fresh.mountFn);
    }
  }

  async #fetchManifestAndModule(
    spec: string,
    parentFolderHandle: DocHandle<FolderDoc>,
    manifestName: string,
  ): Promise<{ manifest: ComponentManifest; mountFn: MountFn }> {
    const manifestHandle = await findHandleInFolderHandle<UnixFileEntry>(
      // findHandleInFolderHandle expects a raw `Repo`; module resolution
      // should never see branched docs.
      this.#repo.repo,
      parentFolderHandle,
      [manifestName],
    );
    if (!manifestHandle) {
      throw new Error(`[overlock-patchwork] manifest not found: ${spec}`);
    }
    const manifest = readManifest(
      manifestHandle as DocHandle<UnixFileEntry>,
      spec,
    );

    const moduleSpec = resolveModuleSpec(spec, manifest.url);
    const pinnedModuleSpec = await pinSpec(this.#repo, moduleSpec);
    const mod = await this.#automergeImport(pinnedModuleSpec);
    const mountFn = extractMountFn(mod, moduleSpec);

    return { manifest, mountFn };
  }

  /**
   * Tear down the old element fully and recreate it under the new tag name.
   * Runs cleanup, copies the current attrs and children to the new element,
   * inserts in place of the old, then mounts. Element identity is lost on
   * purpose — that's the chosen HMR semantics; it's also reused for
   * `doc=` attribute changes so the rebuild path always re-resolves the
   * handle from scratch.
   */
  #rebuildInstance(
    comp: Component,
    newName: string,
    mountFn: MountFn,
  ): void {
    const oldEl = comp.el;
    const parent = oldEl.parentNode;

    this.#mounted.delete(comp);
    comp.unmount();

    if (!parent) return;

    const newEl = oldEl.ownerDocument.createElement(newName);
    for (const attr of Array.from(oldEl.attributes)) {
      newEl.setAttribute(attr.name, attr.value);
    }
    while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
    parent.replaceChild(newEl, oldEl);

    this.#mountElement(newEl, mountFn);
  }

  /**
   * Called when an `<automerge-repo>` element's `.repo` was swapped (via
   * its `checkout` / `fork` / `reset` methods). Rebuilds every Component
   * descendant whose nearest enclosing `<automerge-repo>` is `repoEl`,
   * so each descendant's `doc=` is re-resolved against the new repo and
   * any cached `el.handle` / `el.repo` references are refreshed by
   * `stampLookups`.
   *
   * Components inside a *nested* `<automerge-repo>` are skipped — their
   * scope hasn't changed.
   */
  #rebuildDescendantsOfRepoEl(repoEl: HTMLElement): void {
    const targets: Component[] = [];
    for (const comp of this.#mounted) {
      if (comp.el === repoEl) continue;
      if (!repoEl.contains(comp.el)) continue;
      if (comp.el.closest(REPO_TAG) !== repoEl) continue;
      targets.push(comp);
    }
    for (const comp of targets) {
      this.#rebuildInstance(comp, comp.el.localName, comp.mountFn);
    }
  }

  #mountIfRegistered(el: Element): void {
    if (componentStore.lookup(el)) return;
    const mountFn = this.#registry.get(el.localName);
    if (!mountFn) return;
    this.#mountElement(el as HTMLElement, mountFn);
  }

  /**
   * Construct a Component, await any doc-context resolution against the
   * new element, then run the user's mount fn. The component is added to
   * the mounted set up-front so a removal mid-resolve still invokes the
   * removal path; the post-await `isConnected` guard then short-circuits
   * without calling the user's mount fn.
   */
  #mountElement(el: HTMLElement, mountFn: MountFn): void {
    const comp = new Component(el, mountFn);
    this.#mounted.add(comp);
    void this.#performMount(comp);
  }

  async #performMount(comp: Component): Promise<void> {
    try {
      await this.#resolveContext(comp.el);
    } catch (err) {
      console.error("[overlock-patchwork] doc context resolution failed:", err);
      this.#mounted.delete(comp);
      // `comp.unmount()` here just unregisters from componentStore; no
      // user cleanup has been installed yet. Without this the WeakMap
      // entry would survive a re-add of the same element and prevent a
      // future mount.
      comp.unmount();
      return;
    }
    if (!comp.el.isConnected) {
      this.#mounted.delete(comp);
      comp.unmount();
      return;
    }
    await comp.mount();
  }

  #unmountIfMounted(el: Element): void {
    const comp = componentStore.lookup(el);
    if (!comp || !this.#mounted.has(comp)) return;
    this.#mounted.delete(comp);
    comp.unmount();
  }

  #forEachElement(el: Element, fn: (el: Element) => void): void {
    fn(el);
    this.#forEachElementIn(el, fn);
  }

  #forEachElementIn(root: Element, fn: (el: Element) => void): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as Element | null;
    while (node) {
      fn(node);
      node = walker.nextNode() as Element | null;
    }
  }
}

function swapTag(oldEl: HTMLElement, newTag: string): HTMLElement {
  const parent = oldEl.parentNode;
  const newEl = oldEl.ownerDocument.createElement(newTag);
  for (const attr of Array.from(oldEl.attributes)) {
    if (attr.name === SRC_ATTR) continue;
    newEl.setAttribute(attr.name, attr.value);
  }
  while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
  if (parent) parent.replaceChild(newEl, oldEl);
  return newEl;
}

function readManifest(
  handle: DocHandle<UnixFileEntry>,
  spec: string,
): ComponentManifest {
  const doc = handle.doc();
  const content = doc?.content;
  if (content == null) {
    throw new Error(`[overlock-patchwork] manifest has no content: ${spec}`);
  }
  const text =
    typeof content === "string"
      ? content
      : new TextDecoder().decode(content as Uint8Array);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `[overlock-patchwork] invalid JSON in manifest ${spec}: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { url?: unknown }).url !== "string"
  ) {
    throw new Error(
      `[overlock-patchwork] manifest missing "name" or "url": ${spec}`,
    );
  }
  const manifest = parsed as ComponentManifest;
  if (!manifest.name.includes("-")) {
    throw new Error(
      `[overlock-patchwork] manifest name must contain a hyphen: "${manifest.name}"`,
    );
  }
  return manifest;
}

function extractMountFn(mod: unknown, jsUrl: string): MountFn {
  if (
    typeof mod !== "object" ||
    mod === null ||
    typeof (mod as { default?: unknown }).default !== "function"
  ) {
    throw new Error(
      `[overlock-patchwork] ${jsUrl} does not default-export a function`,
    );
  }
  return (mod as { default: MountFn }).default;
}

function parseSpec(spec: string): { rootUrl: AutomergeUrl; path: string } {
  if (!spec.startsWith("automerge:")) {
    throw new Error(
      `[overlock-patchwork] expected an automerge: spec, got "${spec}"`,
    );
  }
  const slash = spec.indexOf("/", "automerge:".length);
  const urlPart = (slash === -1 ? spec : spec.slice(0, slash)) as AutomergeUrl;
  const path = slash === -1 ? "" : spec.slice(slash + 1);
  if (!isValidAutomergeUrl(urlPart)) {
    throw new Error(
      `[overlock-patchwork] not a valid automerge URL: "${urlPart}"`,
    );
  }
  return { rootUrl: urlPart, path };
}

function splitPath(p: string): string[] {
  return p
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean);
}

/**
 * Resolve a `./component.js`-style sibling reference against the manifest's
 * own spec. Only `./` is supported for now — `../` and bare specifiers are
 * rejected so HMR's pinning semantics stay obvious.
 */
function resolveModuleSpec(manifestSpec: string, relativeUrl: string): string {
  if (!relativeUrl.startsWith("./")) {
    throw new Error(
      `[overlock-patchwork] manifest "url" must start with "./" (got "${relativeUrl}")`,
    );
  }
  const lastSlash = manifestSpec.lastIndexOf("/");
  if (lastSlash === -1 || lastSlash <= "automerge:".length) {
    throw new Error(
      `[overlock-patchwork] cannot resolve "${relativeUrl}" against root spec`,
    );
  }
  const dir = manifestSpec.slice(0, lastSlash);
  return `${dir}/${relativeUrl.slice(2)}`;
}

/**
 * Pre-pin the spec's root url to current heads so `automergeImport`'s blob
 * cache doesn't serve stale content across HMR reloads. Each pinned URL is
 * unique per heads, so each HMR fetch produces a fresh module.
 */
async function pinSpec(repo: BranchableRepo, spec: string): Promise<string> {
  const { rootUrl, path } = parseSpec(spec);
  const { documentId, heads } = parseAutomergeUrl(rootUrl);
  if (heads && heads.length) return spec;
  const handle = await repo.find(rootUrl);
  const pinned = stringifyAutomergeUrl({ documentId, heads: handle.heads() });
  return path ? `${pinned}/${path}` : pinned;
}
