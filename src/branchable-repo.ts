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
  name?: string;
  createdAt?: number;
  clones: Record<AutomergeUrl, AutomergeUrl>;
};

export type ForkOpts = {
  urls?: AutomergeUrl[];
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

// Drop heads so the URL identifies the document, not a snapshot.
function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url);
  return stringifyAutomergeUrl({ documentId });
}

function anyIdToCanonicalUrl(id: AnyDocumentId): AutomergeUrl {
  return stringifyAutomergeUrl({ documentId: interpretAsDocumentId(id) });
}

export class BranchableRepo {
  readonly repo: Repo;
  readonly #branchHandle: DocHandle<BranchDoc> | null;
  readonly #wrapped = new Map<AutomergeUrl, BranchedDocHandle<unknown>>();

  constructor(repo: Repo, branchHandle: DocHandle<BranchDoc> | null = null) {
    this.repo = repo;
    this.#branchHandle = branchHandle;
  }

  get branchHandle(): DocHandle<BranchDoc> | null {
    return this.#branchHandle;
  }

  async fork(opts: ForkOpts = {}): Promise<BranchableRepo> {
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
    const branchHandle = this.repo.create<BranchDoc>(initial);
    const next = new BranchableRepo(this.repo, branchHandle);
    if (opts.urls?.length) {
      await Promise.all(opts.urls.map((u) => next.#snapshotEager(u)));
    }
    return next;
  }

  async checkout(branchDocUrl: AutomergeUrl): Promise<BranchableRepo> {
    const branchHandle = await this.repo.find<BranchDoc>(branchDocUrl);
    if (!isBranchDoc(branchHandle.doc())) {
      throw new Error(
        `branchable-repo: ${branchDocUrl} is not a branch document`,
      );
    }
    return new BranchableRepo(this.repo, branchHandle);
  }

  // Always returns a fresh instance so identity-keyed consumers see a swap.
  reset(): BranchableRepo {
    return new BranchableRepo(this.repo, null);
  }

  create<T>(initialValue?: T): DocHandle<T> {
    return this.repo.create<T>(initialValue);
  }

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

  /** @internal */
  _recordClone(originalUrl: AutomergeUrl, cloneUrl: AutomergeUrl): void {
    if (!this.#branchHandle) {
      throw new Error("branchable-repo: not on a branch");
    }
    this.#branchHandle.change((d) => {
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

    // Pre-populate so the next find() returns the same wrapper.
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
  readonly #listeners = new Map<string, Set<Listener>>();
  #forwarders: Array<{ ev: string; fn: Listener }> = [];

  constructor(opts: WrapperOpts<T>) {
    this.#branched = opts.branched;
    this.#originalUrl = opts.originalUrl;
    this.#originalHandle = opts.originalHandle;
    this.#cloneHandle = opts.cloneHandle;
    this.#forkHeads = opts.forkHeads;
    this.#wireForwarders(this.#active);
  }

  get url(): AutomergeUrl {
    return this.#originalUrl;
  }

  get documentId(): DocumentId {
    return parseAutomergeUrl(this.#originalUrl).documentId;
  }

  // `null` before the first COW.
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

  // No-args form returns branch-vs-original patches; empty off a
  // branch or before the first COW.
  diff(): Patch[];
  diff(first: UrlHeads | DocHandle<T>, second?: UrlHeads): Patch[];
  diff(first?: UrlHeads | DocHandle<T>, second?: UrlHeads): Patch[] {
    if (first === undefined) {
      if (!this.#cloneHandle || !this.#forkHeads) return [];
      return this.#cloneHandle.diff(this.#forkHeads);
    }
    return this.#active.diff(first as UrlHeads | DocHandle<T>, second);
  }

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

  // EventEmitter-compatible subset.
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
        // Swap `handle` for this wrapper so listeners see the identity
        // they registered against.
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
