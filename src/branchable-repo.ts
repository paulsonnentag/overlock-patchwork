// BranchableRepo — a `Repo` wrapper that adds git-style branching to
// Automerge documents.
//
// `forkable.fork()` returns a *new* `BranchableRepo` whose document
// handles are live on the underlying repo until you write to them. The
// first `change()` triggers a copy-on-write clone of the document; from
// that point on the wrapped handle is backed by the clone and writes do
// not disturb the original. The original/clone pairing is recorded in a
// "branch document" stored on the underlying repo, so a branch can be
// reopened later with `BranchableRepo.checkout(repo, branchDocUrl)`.
//
// `forkable.fork(urls)` snapshots the listed documents eagerly at fork
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
  // Map of *original* AutomergeUrl → cloned AutomergeUrl. The clone url
  // has `?heads=` set to the heads of the original at the moment the
  // clone was created — i.e. the fork point. Because `Repo.clone` shares
  // history with the original, those heads are also valid heads inside
  // the clone, which is what makes `handle.diff()` cheap.
  clones: Record<AutomergeUrl, AutomergeUrl>;
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
  readonly branchHandle: DocHandle<BranchDoc> | null;

  readonly #wrapped = new Map<AutomergeUrl, BranchedDocHandle<unknown>>();

  private constructor(repo: Repo, branchHandle: DocHandle<BranchDoc> | null) {
    this.repo = repo;
    this.branchHandle = branchHandle;
  }

  // Wrap an existing `Repo` so it can be forked.
  static wrap(repo: Repo): BranchableRepo {
    return new BranchableRepo(repo, null);
  }

  // Reopen an existing branch by its branch-document url. Returns a
  // `BranchableRepo` whose `find()` calls return handles backed by the
  // branch's clones (or by the original docs, for entries not yet
  // COW'd).
  static async checkout(
    repo: Repo,
    branchDocUrl: AutomergeUrl,
  ): Promise<BranchableRepo> {
    const branchHandle = await repo.find<BranchDoc>(branchDocUrl);
    if (!isBranchDoc(branchHandle.doc())) {
      throw new Error(
        `branchable-repo: ${branchDocUrl} is not a branch document`,
      );
    }
    return new BranchableRepo(repo, branchHandle);
  }

  // Create a new branch off of this repo. Returns a *new*
  // `BranchableRepo`; `this` is unchanged.
  //
  // Without `urls`, documents are cloned lazily on first write
  // (copy-on-write). With `urls`, the listed documents are cloned
  // eagerly — at the heads encoded in each url, if any.
  async fork(urls?: AutomergeUrl[]): Promise<BranchableRepo> {
    if (this.branchHandle) {
      throw new Error(
        "branchable-repo: nested branching is not yet supported",
      );
    }
    const branchHandle = this.repo.create<BranchDoc>({
      [BRANCH_MARKER]: { type: BRANCH_TYPE },
      clones: {},
    });
    const branched = new BranchableRepo(this.repo, branchHandle);
    if (urls?.length) {
      await Promise.all(urls.map((u) => branched.#snapshotEager(u)));
    }
    return branched;
  }

  // Instance form of {@link BranchableRepo.checkout} reusing the underlying repo.
  checkout(branchDocUrl: AutomergeUrl): Promise<BranchableRepo> {
    return BranchableRepo.checkout(this.repo, branchDocUrl);
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

    if (!this.branchHandle) return this.repo.find<T>(original);

    const cached = this.#wrapped.get(original);
    if (cached) return cached as unknown as DocHandle<T>;

    const originalHandle = await this.repo.find<T>(original);
    const cloneEntry = this.branchHandle.doc()?.clones?.[original];

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
    if (!this.branchHandle) {
      throw new Error("branchable-repo: not on a branch");
    }
    this.branchHandle.change((d) => {
      d.clones[originalUrl] = cloneUrl;
    });
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
    // instance, already backed by the clone.
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
