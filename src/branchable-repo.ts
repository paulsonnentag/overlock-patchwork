// BranchableRepo — a `Repo` wrapper that adds git-style branching to
// Automerge documents.
//
// The wrapper is stateful: `fork()`, `checkout()`, and `reset()` mutate
// `this` in place rather than returning a new `BranchableRepo`. Existing
// `BranchedDocHandle`s are rewired to the new branch state silently so
// every reference to a wrapped handle continues to point at the right
// inner doc. Use `copy()` if you need a separate instance.
//
// First `change()` on a wrapped handle triggers a copy-on-write clone of
// the document; from that point on the wrapper is backed by the clone
// and writes do not disturb the original. The original/clone pairing is
// recorded in a "branch document" stored on the underlying repo, so a
// branch can be reopened later with `repo.checkout(branchDocUrl)`.
//
// `repo.fork(urls)` snapshots the listed documents eagerly at fork
// time. URLs may include a `?heads=` segment to fork at a point in time.
//
// Wrapped handles always report the *original* url so the rest of the
// app sees a stable document identity. Reads, events, and writes are
// forwarded to whichever inner handle (original or clone) is active.

import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  interpretAsDocumentId,
  type AnyDocumentId,
  type AutomergeUrl,
  type ChangeFn,
  type Doc,
  type DocHandle,
  type DocumentId,
  type Patch,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";
import type { ChangeOptions } from "@automerge/automerge/slim";

const BRANCH_MARKER = "@patchwork" as const;
const BRANCH_TYPE = "branch" as const;

export type BranchDoc = {
  [BRANCH_MARKER]: { type: typeof BRANCH_TYPE };
  // Human-readable branch name. Optional; populated by `fork({ name })`.
  name?: string;
  // Wall-clock millis at fork time. Optional; populated by `fork()`.
  createdAt?: number;
  // Map of *original* AutomergeUrl → cloned AutomergeUrl. The clone url
  // has `?heads=` set to the heads of the original at the moment the
  // clone was created — i.e. the fork point. Because `Repo.clone` shares
  // history with the original, those heads are also valid heads inside
  // the clone, which is what makes `handle.diff()` cheap.
  clones: Record<AutomergeUrl, AutomergeUrl>;
};

export type ForkOpts = {
  // Documents to clone eagerly at fork time. URLs may include a
  // `?heads=` segment to fork at a specific point in time. Without this
  // list, documents are cloned lazily on first write (copy-on-write).
  urls?: AutomergeUrl[];
  // Human-readable branch name stored on the new branch document.
  name?: string;
};

function isBranchDoc(value: unknown): value is BranchDoc {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const marker = v[BRANCH_MARKER] as { type?: string } | undefined;
  return (
    marker?.type === BRANCH_TYPE &&
    !!v.clones &&
    typeof v.clones === "object"
  );
}

// Strip any `?heads=…` segment so the url identifies the *document*.
function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url);
  return stringifyAutomergeUrl({ documentId });
}

function anyIdToCanonicalUrl(id: AnyDocumentId): AutomergeUrl {
  return stringifyAutomergeUrl({ documentId: interpretAsDocumentId(id) });
}

export class BranchableRepo {
  // The underlying Automerge repo. Network/storage live here.
  readonly repo: Repo;

  // The branch document, or `null` if this repo is not on a branch.
  // Mutated in place by `fork`, `checkout`, and `reset`.
  #branchHandle: DocHandle<BranchDoc> | null;

  readonly #wrapped = new Map<AutomergeUrl, BranchedDocHandle<unknown>>();

  private constructor(repo: Repo, branchHandle: DocHandle<BranchDoc> | null) {
    this.repo = repo;
    this.#branchHandle = branchHandle;
  }

  // The branch document, or `null` off-branch. Read-only — drive state
  // changes through `fork` / `checkout` / `reset`.
  get branchHandle(): DocHandle<BranchDoc> | null {
    return this.#branchHandle;
  }

  // Wrap an existing `Repo` so it can be forked.
  static wrap(repo: Repo): BranchableRepo {
    return new BranchableRepo(repo, null);
  }

  // Create a new branch and switch to it in place. Throws if already on
  // a branch — nested branching is not yet supported.
  //
  // Without `urls`, documents are cloned lazily on first write
  // (copy-on-write). With `urls`, the listed documents are cloned
  // eagerly — at the heads encoded in each url, if any. `name` is
  // recorded on the branch document so UI can render a label without
  // separately tracking metadata.
  //
  // Existing `BranchedDocHandle`s are rewired to the new branch state.
  async fork(opts: ForkOpts = {}): Promise<void> {
    if (this.#branchHandle) {
      throw new Error(
        "branchable-repo: nested branching is not yet supported",
      );
    }
    const initial: BranchDoc = {
      [BRANCH_MARKER]: { type: BRANCH_TYPE },
      createdAt: Date.now(),
      clones: {},
    };
    if (opts.name !== undefined) initial.name = opts.name;
    this.#branchHandle = this.repo.create<BranchDoc>(initial);
    if (opts.urls?.length) {
      await Promise.all(opts.urls.map((u) => this.#snapshotEager(u)));
    }
    await this.#rewireWrappedHandles();
  }

  // Switch to an existing branch in place. Existing
  // `BranchedDocHandle`s are rewired to the branch's clones (or back to
  // their originals for docs not yet COW'd on this branch).
  async checkout(branchDocUrl: AutomergeUrl): Promise<void> {
    const branchHandle = await this.repo.find<BranchDoc>(branchDocUrl);
    if (!isBranchDoc(branchHandle.doc())) {
      throw new Error(
        `branchable-repo: ${branchDocUrl} is not a branch document`,
      );
    }
    this.#branchHandle = branchHandle;
    await this.#rewireWrappedHandles();
  }

  // Drop the branch context in place, returning to off-branch mode.
  // Existing `BranchedDocHandle`s are rewired to their originals.
  reset(): void {
    this.#branchHandle = null;
    for (const wrapped of this.#wrapped.values()) {
      wrapped._rewire({ cloneHandle: null, forkHeads: null });
    }
  }

  // Create a fresh `BranchableRepo` over the same underlying `Repo`,
  // pointed at the current branch (or off-branch). The two instances
  // share the underlying repo but maintain independent wrapped-handle
  // caches and can be navigated independently.
  copy(): BranchableRepo {
    return new BranchableRepo(this.repo, this.#branchHandle);
  }

  // Create a new document. While on a branch, the new doc lives on the
  // underlying repo and is *not* tracked in `clones`: it has no original
  // to fork from and is "branch-native".
  create<T>(initialValue?: T): DocHandle<T> {
    return this.repo.create<T>(initialValue);
  }

  // Find a document, returning a handle that respects the branch state.
  async find<T>(id: AnyDocumentId): Promise<DocHandle<T>> {
    const original = anyIdToCanonicalUrl(id);

    if (!this.#branchHandle) return this.repo.find<T>(original);

    const cached = this.#wrapped.get(original);
    if (cached) return cached as unknown as DocHandle<T>;

    const originalHandle = await this.repo.find<T>(original);
    const cloneEntry = this.#branchHandle.doc()?.clones?.[original];

    let cloneHandle: DocHandle<T> | null = null;
    let forkHeads: UrlHeads | null = null;
    if (cloneEntry) {
      cloneHandle = await this.repo.find<T>(canonicalUrl(cloneEntry));
      forkHeads = parseAutomergeUrl(cloneEntry).heads ?? null;
    }

    const wrapped = new BranchedDocHandle<T>({
      branched: this,
      originalUrl: original,
      originalHandle,
      cloneHandle,
      forkHeads,
    });
    this.#wrapped.set(
      original,
      wrapped as unknown as BranchedDocHandle<unknown>,
    );
    return wrapped as unknown as DocHandle<T>;
  }

  // Called by `BranchedDocHandle` after a copy-on-write so the branch
  // document gets the new clone url recorded.
  /** @internal */
  _recordClone(originalUrl: AutomergeUrl, cloneUrl: AutomergeUrl): void {
    if (!this.#branchHandle) {
      throw new Error("branchable-repo: not on a branch");
    }
    this.#branchHandle.change((d) => {
      d.clones[originalUrl] = cloneUrl;
    });
  }

  // Re-derive `cloneHandle` / `forkHeads` for every cached
  // `BranchedDocHandle` against the current branch state, then point
  // each wrapper at the new pair. No event is fired for the swap
  // itself — content-driven `change` events keep flowing through the
  // wrapper's existing forwarders, now bound to the new inner.
  async #rewireWrappedHandles(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [originalUrl, wrapped] of this.#wrapped) {
      tasks.push(this.#rewireOne(originalUrl, wrapped));
    }
    await Promise.all(tasks);
  }

  async #rewireOne(
    originalUrl: AutomergeUrl,
    wrapped: BranchedDocHandle<unknown>,
  ): Promise<void> {
    const cloneEntry = this.#branchHandle?.doc()?.clones?.[originalUrl];
    let cloneHandle: DocHandle<unknown> | null = null;
    let forkHeads: UrlHeads | null = null;
    if (cloneEntry) {
      cloneHandle = await this.repo.find<unknown>(canonicalUrl(cloneEntry));
      forkHeads = parseAutomergeUrl(cloneEntry).heads ?? null;
    }
    wrapped._rewire({ cloneHandle, forkHeads });
  }

  async #snapshotEager(url: AutomergeUrl): Promise<void> {
    const original = canonicalUrl(url);
    const requestedHeads = parseAutomergeUrl(url).heads;
    const originalHandle = await this.repo.find<unknown>(original);
    const source = requestedHeads
      ? originalHandle.view(requestedHeads)
      : originalHandle;
    const cloned = this.repo.clone(source);
    const forkHeads = requestedHeads ?? originalHandle.heads();
    const cloneUrl = stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(cloned.url).documentId,
      heads: forkHeads,
    });
    this._recordClone(original, cloneUrl);

    // Pre-populate the wrapper cache so the next find() returns the same
    // instance, already backed by the clone. If a wrapper for this
    // original already exists (e.g. created before fork), rewire it
    // instead of replacing — callers may still hold the old reference.
    const existing = this.#wrapped.get(original);
    if (existing) {
      existing._rewire({ cloneHandle: cloned, forkHeads });
      return;
    }
    const wrapped = new BranchedDocHandle({
      branched: this,
      originalUrl: original,
      originalHandle,
      cloneHandle: cloned,
      forkHeads,
    });
    this.#wrapped.set(original, wrapped);
  }
}

// ---------------------------------------------------------------------------
// BranchedDocHandle
//
// A wrapper that exposes the public DocHandle surface used by this
// codebase. It:
//   • reports the *original* url, keeping doc identity stable
//   • delegates reads to whichever inner handle is currently active
//     (original until first write, clone afterwards)
//   • re-emits events from the active inner handle, swapping
//     subscriptions across the COW boundary
//   • intercepts change/changeAt/merge to trigger copy-on-write
//   • overloads diff() so the no-args form returns branch-vs-original

const FORWARDED_EVENTS = [
  "change",
  "heads-changed",
  "delete",
  "ephemeral-message",
  "ephemeral-message-outbound",
  "remote-heads",
] as const;

type WrapperOpts<T> = {
  branched: BranchableRepo;
  originalUrl: AutomergeUrl;
  originalHandle: DocHandle<T>;
  cloneHandle: DocHandle<T> | null;
  forkHeads: UrlHeads | null;
};

type Listener = (...args: unknown[]) => void;

export class BranchedDocHandle<T> {
  readonly #branched: BranchableRepo;
  readonly #originalUrl: AutomergeUrl;
  readonly #originalHandle: DocHandle<T>;
  #cloneHandle: DocHandle<T> | null;
  #forkHeads: UrlHeads | null;

  // Listeners registered through *this* wrapper.
  readonly #listeners = new Map<string, Set<Listener>>();
  // Internal forwarders attached to the currently-active inner handle.
  #forwarders: Array<{ ev: string; fn: Listener }> = [];

  constructor(opts: WrapperOpts<T>) {
    this.#branched = opts.branched;
    this.#originalUrl = opts.originalUrl;
    this.#originalHandle = opts.originalHandle;
    this.#cloneHandle = opts.cloneHandle;
    this.#forkHeads = opts.forkHeads;
    this.#wireForwarders(this.#active);
  }

  // Always reports the *original* url, keeping the illusion stable.
  get url(): AutomergeUrl {
    return this.#originalUrl;
  }

  get documentId(): DocumentId {
    return parseAutomergeUrl(this.#originalUrl).documentId;
  }

  // The clone url (with fork heads), or `null` if no COW has happened.
  get cloneUrl(): AutomergeUrl | null {
    if (!this.#cloneHandle || !this.#forkHeads) return null;
    return stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(this.#cloneHandle.url).documentId,
      heads: this.#forkHeads,
    });
  }

  get #active(): DocHandle<T> {
    return this.#cloneHandle ?? this.#originalHandle;
  }

  // ------ read passthroughs ------

  get state() {
    return this.#active.state;
  }

  isReady = (): boolean => this.#active.isReady();
  isUnloaded = (): boolean => this.#active.isUnloaded();
  isDeleted = (): boolean => this.#active.isDeleted();
  isUnavailable = (): boolean => this.#active.isUnavailable();

  inState(states: Parameters<DocHandle<T>["inState"]>[0]): boolean {
    return this.#active.inState(states);
  }

  whenReady(states?: Parameters<DocHandle<T>["whenReady"]>[0]): Promise<void> {
    return this.#active.whenReady(states);
  }

  doc(): Doc<T> {
    return this.#active.doc();
  }
  docSync(): Doc<T> {
    return this.#active.docSync();
  }
  heads(): UrlHeads {
    return this.#active.heads();
  }
  history(): UrlHeads[] {
    return this.#active.history();
  }
  metadata(change?: string): ReturnType<DocHandle<T>["metadata"]> {
    return this.#active.metadata(change);
  }
  view(heads: UrlHeads): DocHandle<T> {
    return this.#active.view(heads);
  }
  isReadOnly(): boolean {
    return this.#active.isReadOnly();
  }
  metrics(): ReturnType<DocHandle<T>["metrics"]> {
    return this.#active.metrics();
  }
  ref(
    ...segments: Parameters<DocHandle<T>["ref"]>
  ): ReturnType<DocHandle<T>["ref"]> {
    return (
      this.#active.ref as (
        ...a: Parameters<DocHandle<T>["ref"]>
      ) => ReturnType<DocHandle<T>["ref"]>
    )(...segments);
  }
  getRemoteHeads(
    storageId: Parameters<DocHandle<T>["getRemoteHeads"]>[0],
  ): ReturnType<DocHandle<T>["getRemoteHeads"]> {
    return this.#active.getRemoteHeads(storageId);
  }
  getSyncInfo(
    storageId: Parameters<DocHandle<T>["getSyncInfo"]>[0],
  ): ReturnType<DocHandle<T>["getSyncInfo"]> {
    return this.#active.getSyncInfo(storageId);
  }
  broadcast(message: unknown): void {
    this.#active.broadcast(message);
  }

  // ------ diff overload ------

  // No-args: branch-vs-original patches. Empty array if not on a branch
  // or before the first COW.
  // With args: delegates to the underlying `DocHandle.diff`.
  diff(): Patch[];
  diff(first: UrlHeads | DocHandle<T>, second?: UrlHeads): Patch[];
  diff(first?: UrlHeads | DocHandle<T>, second?: UrlHeads): Patch[] {
    if (first === undefined) {
      if (!this.#cloneHandle || !this.#forkHeads) return [];
      return this.#cloneHandle.diff(this.#forkHeads);
    }
    return this.#active.diff(first as UrlHeads | DocHandle<T>, second);
  }

  // ------ writes (trigger COW) ------

  change(callback: ChangeFn<T>, options?: ChangeOptions<T>): void {
    this.#triggerCOW();
    this.#active.change(callback, options);
  }

  changeAt(
    heads: UrlHeads,
    callback: ChangeFn<T>,
    options?: ChangeOptions<T>,
  ): UrlHeads | undefined {
    this.#triggerCOW();
    return this.#active.changeAt(heads, callback, options);
  }

  merge(other: DocHandle<T>): void {
    this.#triggerCOW();
    const inner =
      other instanceof BranchedDocHandle
        ? ((other as BranchedDocHandle<T>).#active as DocHandle<T>)
        : other;
    this.#active.merge(inner);
  }

  // ------ events (EventEmitter-compatible subset) ------

  on(ev: string, fn: Listener): this {
    let set = this.#listeners.get(ev);
    if (!set) {
      set = new Set();
      this.#listeners.set(ev, set);
    }
    set.add(fn);
    return this;
  }

  off(ev: string, fn: Listener): this {
    this.#listeners.get(ev)?.delete(fn);
    return this;
  }

  once(ev: string, fn: Listener): this {
    const wrapper: Listener = (...args) => {
      this.off(ev, wrapper);
      fn(...args);
    };
    return this.on(ev, wrapper);
  }

  addListener(ev: string, fn: Listener): this {
    return this.on(ev, fn);
  }

  removeListener(ev: string, fn: Listener): this {
    return this.off(ev, fn);
  }

  removeAllListeners(ev?: string): this {
    if (ev) this.#listeners.get(ev)?.clear();
    else this.#listeners.clear();
    return this;
  }

  emit(ev: string, ...args: unknown[]): boolean {
    const set = this.#listeners.get(ev);
    if (!set || set.size === 0) return false;
    for (const fn of [...set]) fn(...args);
    return true;
  }

  // Re-point this wrapper at a new (cloneHandle, forkHeads) pair. Called
  // by `BranchableRepo` after a `fork` / `checkout` / `reset` so cached
  // wrappers track the new branch state without losing identity. Does
  // not synthesise any events: forwarders are simply moved from the old
  // active inner to the new one, and listeners observe content changes
  // through whatever `change` events the new inner naturally emits.
  /** @internal */
  _rewire(opts: {
    cloneHandle: DocHandle<unknown> | null;
    forkHeads: UrlHeads | null;
  }): void {
    const previousActive = this.#active;
    this.#cloneHandle = opts.cloneHandle as DocHandle<T> | null;
    this.#forkHeads = opts.forkHeads;
    const nextActive = this.#active;
    if (previousActive === nextActive) return;
    this.#unwireForwarders(previousActive);
    this.#wireForwarders(nextActive);
  }

  // ------ internals ------

  #triggerCOW(): void {
    if (this.#cloneHandle) return;
    const heads = this.#originalHandle.heads();
    const cloned = this.#branched.repo.clone(this.#originalHandle);
    this.#cloneHandle = cloned;
    this.#forkHeads = heads;

    this.#unwireForwarders(this.#originalHandle);
    this.#wireForwarders(cloned);

    const cloneUrl = stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(cloned.url).documentId,
      heads,
    });
    this.#branched._recordClone(this.#originalUrl, cloneUrl);
  }

  #wireForwarders(target: DocHandle<T>): void {
    for (const ev of FORWARDED_EVENTS) {
      const fn: Listener = (payload: unknown) => {
        // Replace `handle` in the payload (if present) with this wrapper
        // so listeners see the same identity they registered against.
        if (
          payload &&
          typeof payload === "object" &&
          "handle" in (payload as Record<string, unknown>)
        ) {
          this.emit(ev, { ...(payload as object), handle: this });
        } else {
          this.emit(ev, payload);
        }
      };
      this.#forwarders.push({ ev, fn });
      (target as unknown as { on(ev: string, fn: Listener): void }).on(ev, fn);
    }
  }

  #unwireForwarders(target: DocHandle<T>): void {
    for (const { ev, fn } of this.#forwarders) {
      (target as unknown as { off(ev: string, fn: Listener): void }).off(
        ev,
        fn,
      );
    }
    this.#forwarders = [];
  }
}
