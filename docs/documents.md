# Documents

Two ways into Automerge: ask the *repo* (e.g. to create a doc) or
receive a `DocHandle` for an *existing* doc. Both go through
`window.repo` — there's no per-subtree scope.

For lifecycle around `el.handle` resolution and `doc=` rebuilds see
[`lifecycle.md`](./lifecycle.md). For sharing non-document values see
[`context.md`](./context.md).

## `window.repo` / `el.repo`

[`src/main.ts`](../src/main.ts) constructs one `BranchableRepo` and
assigns it to `window.repo` before the view registry starts. Every
mounted view gets the same instance stamped on as `el.repo`
(synchronously, inside `mountView`). `BranchableRepo` is a thin
forkable wrapper — while unbranched, every method delegates to the
underlying `Repo`, so `repo.find(...)` / `repo.create(...)` work as
on a raw `Repo`.

## `doc=` on `<patchwork-view>`

```html
<patchwork-view doc="automerge:..." src="automerge:.../counter.json"></patchwork-view>
```

The registry awaits `repo.find(url)` and stamps the resulting
`DocHandle` onto the swapped element as `el.handle` before the mount
fn runs. The mount fn reads it directly:

```js
export default async function (element) {
  const handle = element.handle;
  // handle.doc(), handle.change(...), handle.on("change", ...)
}
```

A Solid-friendly projection is available via
[`automerge-repo-solid-primitives`](https://github.com/automerge/automerge-repo/tree/main/packages/automerge-repo-solid-primitives).

`doc=` is strict: invalid URL aborts the mount. Absent, `el.handle`
stays `undefined`.

## Reactive `doc=`

The MutationObserver watches `doc` attribute changes. When `doc=` on a
mounted view changes, the registry schedules a microtask-batched
rebuild (same teardown + remount as HMR — see
[`lifecycle.md`](./lifecycle.md)). Several writes in the same tick
coalesce into one rebuild that reads the final URL.

Because mounting is top-down, an ancestor mount fn can write `doc=`
on still-dormant descendants and they'll read the fresh value during
their own first mount — no rebuild needed.

## Branching

`element.repo` is a `BranchableRepo` — see
[`src/branchable-repo.ts`](../src/branchable-repo.ts) for the full
contract:

```ts
repo.fork(opts?: { urls?: AutomergeUrl[]; name?: string }): Promise<void>
repo.checkout(branchDocUrl: AutomergeUrl): Promise<void>
repo.reset(): void
repo.copy(): BranchableRepo
repo.branchHandle: DocHandle<BranchDoc> | null
```

> **Status.** Wrapper is shipped but no UI calls
> `fork`/`checkout`/`reset` today. Calls would mutate `window.repo`
> in place — affecting every mounted view, since
> `element.repo === window.repo` for all views and the registry
> doesn't selectively rebuild on branch swaps.

A branch is an Automerge doc storing
`{ originalUrl → cloneUrl }`. The clone url carries the original's
heads at fork time, so diffing is cheap. First write triggers
copy-on-write; subsequent reads come from the clone.

`fork({ urls })` clones URLs eagerly. URLs may carry heads built via
`stringifyAutomergeUrl({ documentId, heads })` to fork at a specific
point in time. Branch-native docs created with `repo.create()` while
on a branch live on the underlying repo and aren't tracked in the
branch's `clones` map. Nested branching (fork-while-branched)
currently throws.
