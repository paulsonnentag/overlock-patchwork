# Documents

Views opt into Automerge documents in two complementary ways: by
asking the *repo* itself (e.g. to create a new doc) and by receiving a
`DocHandle` to an *existing* doc. Both go through `window.repo` —
there is no per-subtree repo scope.

For the lifecycle around `el.handle` resolution and the rebuild on
attribute change see [`lifecycle.md`](./lifecycle.md).

## `window.repo` — the page repo

[`src/main.ts`](../src/main.ts) constructs a single `BranchableRepo`
and assigns it to `window.repo` before the view registry starts. The
registry stamps the same instance onto every mounted view as
`el.repo`:

```js
export default function (element) {
  const repo = element.repo;             // === window.repo
  const handle = repo.create({ count: 0 });
  // ...
}
```

`BranchableRepo` is a thin forkable wrapper around an Automerge
`Repo`. While unbranched, every method delegates straight to the
underlying repo, so `repo.find(...)` / `repo.create(...)` work exactly
as if you had a raw `Repo`. See [Branching](#branching) below for how
to fork the repo and walk a branch's handles.

`element.repo` is set synchronously inside `mountView`, so it's
available the moment the mount fn runs.

## `doc=` attribute on `<patchwork-view>`

Set `doc=` to an `automerge:...` URL to ask the registry for a
`DocHandle` to that document before your mount fn runs:

```html
<patchwork-view
  doc="automerge:..."
  src="automerge:.../counter.json"
></patchwork-view>
```

The registry awaits `window.repo.find(url)` and stamps the resulting
handle onto the swapped element as a JS property (`el.handle`). The
mount fn picks it up directly:

```js
import { makeDocumentProjection } from
  "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

export default async function (element) {
  const handle = element.handle;
  const doc = makeDocumentProjection(handle);
  return render(
    () => html`
      <button onClick=${() => handle.change(d => d.count++)}>
        count: ${() => doc.count ?? 0}
      </button>
    `,
    element,
  );
}
```

`makeDocumentProjection` is the no-reactive-input primitive from
[`automerge-repo-solid-primitives`](https://github.com/automerge/automerge-repo/tree/main/packages/automerge-repo-solid-primitives).
It hands back a fine-grained Solid store proxy that updates on every
incoming patch. Component authors can also drop down to plain
`handle.doc()` and `handle.on("change", ...)` if they don't want a
framework primitive.

`doc=` is strict: an invalid URL aborts the mount with an error.
Absent, `el.handle` stays `undefined` and the view just renders
without one.

## Reactive `doc=`

The `MutationObserver` watches `doc` attribute changes on every
element in its tree (`{ attributes: true, attributeFilter: ["doc"] }`).
When the attribute changes on a *mounted* view, the registry
schedules a rebuild on the next microtask — same teardown + recreate
dance as HMR (see [`lifecycle.md`](./lifecycle.md)). The new element's
`el.handle` reflects the new URL; the view's cleanup runs between the
old and new mount.

Rebuilds are **microtask-batched**, so a context-provider that flips
`doc=` through several intermediate values in one synchronous block
(typical for a Solid `effect` that reads off a fine-grained store)
produces a single rebuild that sees the final URL — not one rebuild
per intermediate write.

A change to `doc=` on a `<patchwork-view>` *before* bootstrap completes
is picked up naturally — bootstrap reads the attribute when it
resolves the context, and an in-flight resolve is just superseded by
the rebuild.

## Branching

`element.repo` is a `BranchableRepo`, a stateful wrapper over a plain
Automerge `Repo`:

```ts
repo.fork(opts?: { urls?: AutomergeUrl[]; name?: string }): Promise<void>
repo.checkout(branchDocUrl: AutomergeUrl): Promise<void>
repo.reset(): void
repo.copy(): BranchableRepo
repo.branchHandle: DocHandle<BranchDoc> | null   // read-only
```

> **Status.** The wrapper is shipped, but there is currently **no UI
> mechanism wired up that calls `fork`/`checkout`/`reset`**. The page
> always runs against the un-branched root. The API is documented
> here so the wrapper's contract is preserved while a branching UI is
> rebuilt; views that *call* it today will mutate `window.repo` for
> the whole page (see the warning below).

A *branch* is just another Automerge document that records a map of
`{ originalUrl → cloneUrl }`. The clone url carries the heads of the
original at the moment the clone was created (the *fork point*).
`Repo.clone` shares history with the original, so those heads are
valid heads inside the clone too — which is what makes diffing cheap.

`fork`, `checkout`, and `reset` mutate the repo **in place**: the same
`BranchableRepo` instance is navigated to a new branch (or back
off-branch). Existing wrapped handles obtained through `repo.find(...)`
keep their identity and rewire to the new branch state silently — no
synthetic event is fired for the swap, but content-driven `change`
events keep flowing through the wrapper as the underlying inner
document changes. Use `copy()` to obtain an independent
`BranchableRepo` over the same underlying `Repo`.

Because `element.repo === window.repo` for every view, mutating it
affects every mounted view at once. There is no hook for the registry
to selectively rebuild a subtree on a branch swap; consumers that
need to react to a branch change have to wire it themselves (e.g.
by listening on `branchHandle`).

The first `handle.change(...)` on a branched repo triggers a
copy-on-write clone of the underlying doc, and from that point on the
proxy is backed by the clone:

```js
await element.repo.fork();             // mutates element.repo in place
const handle = await element.repo.find(originalUrl);

handle.url;                        // still the *original* url
handle.doc();                      // reads from the original
handle.change(d => d.title = "x"); // first write — clones, branch doc updated
handle.diff();                     // patches from forkHeads → current
```

Pass `urls` to `fork({ urls })` to clone them eagerly at fork time.
URLs may carry heads to fork at a specific point in time — build
them with `stringifyAutomergeUrl({ documentId, heads })`:

```js
await element.repo.fork({
  urls: [
    "automerge:abc...",                                    // live url — current heads
    stringifyAutomergeUrl({ documentId: "def...", heads }), // pinned to historical heads
  ],
  name: "experiment",
});
```

`element.repo.branchHandle` is a `DocHandle<BranchDoc>` whose url you
can pass to `repo.checkout(branchDocUrl)` later to reopen the branch.

`handle.diff()` (no args) returns the patches between the fork point
and the branch's current heads, or `[]` before the first COW or
off-branch. The two-arg form delegates to the underlying
`DocHandle.diff(first, second?)`.

Branch-native documents — those created via `element.repo.create({...})`
while on a branch — live on the underlying repo and are not tracked
in the branch's `clones` map; they have no original to fork from.

Forking from an already-branched repo (`fork()` while
`branchHandle !== null`) currently throws — nested branching will be
added later.

See [`src/branchable-repo.ts`](../src/branchable-repo.ts) for the
implementation.
