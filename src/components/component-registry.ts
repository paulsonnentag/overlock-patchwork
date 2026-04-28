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

import { BranchableRepo } from "../branchable-repo";
import { AutomergeRepoElement, AUTOMERGE_REPO_TAG } from "./automerge-repo-element";
import { PATCHWORK_VIEW_TAG } from "./patchwork-view-element";
import {
  isComponent,
  mountComponent,
  unmountElement,
} from "./component";
import type { ComponentManifest, MountFn } from "../types";

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
 * One mount root. Owns the component-name table, the manifest-load cache,
 * and a `MutationObserver` over the root element. Per-element instance
 * state lives in `component.ts`'s module-private `cleanups` map; the
 * registry doesn't track Component instances itself — the element is the
 * identity carrier. Tears everything down on `destroy()`.
 *
 * `<patchwork-view src="automerge:.../component.json">` is the bootstrap tag:
 * the registry recognizes it, fetches the referenced manifest + JS module
 * from the automerge graph, registers the manifest's `name` as a component,
 * replaces the `<patchwork-view>` element with `<name>` (carrying over
 * non-`src` attributes and children), and calls `mountComponent` against
 * the new element.
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

  // Tracks which <patchwork-view> elements have already been claimed by a
  // bootstrap, so a remove + re-add cycle on the same node doesn't kick off
  // a duplicate load.
  readonly #bootstrapping = new WeakSet<Element>();

  // Elements whose `doc=` flipped this tick. Drained on a microtask so
  // multiple synchronous attribute writes (e.g. a context-provider running
  // through several values in one Solid effect) coalesce into a single
  // rebuild that reads the *final* attribute value. Keyed by element so
  // a rebuild that swaps the element identity (HMR or doc-rebuild) leaves
  // the stale old element in the set; the flush filters it out via
  // `isComponent` and operates only on the current live element.
  readonly #pendingRebuilds = new Set<HTMLElement>();
  #rebuildScheduled = false;

  #observer: MutationObserver | null = null;

  constructor(root: HTMLElement, deps: Deps) {
    this.#root = root;
    this.#repo = deps.repo;
    this.#automergeImport = deps.automergeImport;

    this.#forEachElementIn(root, (el) => this.#handleElement(el));

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (record.attributeName !== "doc") continue;
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
            unmountElement(el);
          });
        }
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["doc"],
    });
    this.#observer = observer;
  }

  destroy(): void {
    if (this.#observer === null) return;
    this.#observer.disconnect();
    this.#observer = null;
    this.#pendingRebuilds.clear();
    // Walk the root subtree and tear down every claimed element. The
    // element-keyed `cleanups` map is the source of truth; `unmountElement`
    // is a no-op on anything we walk that isn't a component.
    this.#forEachElementIn(this.#root, (el) => unmountElement(el));
    for (const loaded of this.#loaded.values()) loaded.unsubscribe();
    this.#loaded.clear();
    this.#loading.clear();
    this.#registry.clear();
  }

  #handleElement(el: Element): void {
    if (el.localName === AUTOMERGE_REPO_TAG) {
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
          AUTOMERGE_REPO_TAG,
        ) as AutomergeRepoElement | null;
        repoEl.repo = ancestor?.repo ?? this.#repo;
      }
      if (!repoEl._rebuildDescendants) {
        repoEl._rebuildDescendants = () =>
          this.#rebuildDescendantsOfRepoEl(repoEl);
      }
      return;
    }
    if (el.localName === PATCHWORK_VIEW_TAG) {
      const src = el.getAttribute("src");
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
   * 2. Mounted component — schedule a rebuild on the next microtask.
   *    The rebuild path swaps the element so `mountComponent` reads
   *    the fresh `doc=` from scratch and resolves the new handle.
   * 3. Anything else — ignore.
   *
   * The rebuild is microtask-batched so a series of synchronous `doc=`
   * writes in the same tick coalesce into one rebuild that reads the
   * final attribute value. Without batching, a context-provider that
   * iterates through three intermediate URLs in one effect would
   * tear down and re-mount the same descendant three times.
   */
  #handleDocAttributeChange(el: HTMLElement): void {
    if (!isComponent(el)) return;
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
      if (!isComponent(el)) continue;
      const mountFn = this.#registry.get(el.localName);
      if (!mountFn) continue;
      this.#rebuildInstance(el, el.localName, mountFn);
    }
  }

  /**
   * The 4-step `<patchwork-view>` handoff:
   *   1. fetch component.json via the repo
   *   2. register manifest.name → mountFn (throw on collision)
   *   3. replace <patchwork-view> with <manifest.name> (keep non-src attrs + children)
   *   4. call `mountComponent` against the new element
   *
   * The mount fn's per-element doc context (read `doc=`, await
   * `repo.find(url)`, stamp `el.handle`) is resolved inside
   * `mountComponent` itself before the user's mount fn runs. The folder
   * subscription that drives HMR is set up inside `#load`.
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
    mountComponent(newEl, loaded.mountFn);
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
   * module, then for every element currently mounted under the previous
   * tag name: tear it down (run cleanup), recreate a fresh element with
   * the new tag name, and mount the new mount fn against it.
   *
   * If the manifest's `name` changed, drop the old name from the registry
   * and check the new one for collision.
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
    const instances = this.#findMountedElements(this.#root, previousName);

    if (fresh.manifest.name !== previousName) {
      this.#registry.delete(previousName);
    }
    this.#registry.set(fresh.manifest.name, fresh.mountFn);
    old.manifest = fresh.manifest;
    old.mountFn = fresh.mountFn;

    for (const el of instances) {
      this.#rebuildInstance(el, fresh.manifest.name, fresh.mountFn);
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
   *
   * Order of operations matters: `unmountElement(oldEl)` runs the old
   * cleanup *before* `mountComponent(newEl)` claims the new element and
   * starts the next lifecycle, so cleanup-before-new-mount ordering is
   * preserved. The MO will later see `removedNodes: [oldEl]` and call
   * `unmountElement(oldEl)` again — that's a no-op because the entry is
   * already gone from the cleanups map.
   */
  #rebuildInstance(
    oldEl: HTMLElement,
    newName: string,
    mountFn: MountFn,
  ): void {
    const parent = oldEl.parentNode;
    unmountElement(oldEl);
    if (!parent) return;

    const newEl = oldEl.ownerDocument.createElement(newName);
    for (const attr of Array.from(oldEl.attributes)) {
      newEl.setAttribute(attr.name, attr.value);
    }
    while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
    parent.replaceChild(newEl, oldEl);

    mountComponent(newEl, mountFn);
  }

  /**
   * Called when an `<automerge-repo>` element's `.repo` was swapped (via
   * its `checkout` / `fork` / `reset` methods). Rebuilds every component
   * descendant whose nearest enclosing `<automerge-repo>` is `repoEl`,
   * so each descendant's `doc=` is re-resolved against the new repo and
   * `el.repo` is re-stamped on the fresh element.
   *
   * Components inside a *nested* `<automerge-repo>` are skipped — their
   * scope hasn't changed.
   */
  #rebuildDescendantsOfRepoEl(repoEl: HTMLElement): void {
    const targets: HTMLElement[] = [];
    this.#forEachElementIn(repoEl, (el) => {
      if (!(el instanceof HTMLElement)) return;
      if (!isComponent(el)) return;
      if (el.closest(AUTOMERGE_REPO_TAG) !== repoEl) return;
      targets.push(el);
    });
    for (const el of targets) {
      const mountFn = this.#registry.get(el.localName);
      if (!mountFn) continue;
      this.#rebuildInstance(el, el.localName, mountFn);
    }
  }

  #mountIfRegistered(el: Element): void {
    if (isComponent(el)) return;
    const mountFn = this.#registry.get(el.localName);
    if (!mountFn) return;
    mountComponent(el as HTMLElement, mountFn);
  }

  /**
   * Snapshot of every element under `root` that currently has tag `tag`
   * and is a claimed component. Snapshotted up-front because the HMR
   * rebuild loop mutates the DOM as it goes.
   */
  #findMountedElements(root: HTMLElement, tag: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    this.#forEachElementIn(root, (el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.localName !== tag) return;
      if (!isComponent(el)) return;
      out.push(el);
    });
    return out;
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
    if (attr.name === "src") continue;
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
