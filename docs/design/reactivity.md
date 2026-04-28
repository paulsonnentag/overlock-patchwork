# Reactive context

> **Status: design sketch, not implemented.** The behavior described
> here is a target shape, not what the code does today. See
> [`docs/README.md`](../README.md) for the actual architecture and
> [`design/README.md`](./README.md) for what this folder is.

Views depend on context derived from their position in the DOM: the
scope repo and the resolved doc handle. Both are read once today and
stamped onto the element as a property. Several things can change
after that read without any signal back to the consumer.

This note is in three parts:

1. [Where reactivity is missing](#where-reactivity-is-missing) — a
   characterization of the failure modes by trigger and by consumer.
2. [Proposed shape: `Subscribable<T>`](#proposed-shape-subscribablet) —
   borrowing the interface from
   [`patchwork-tools/paper-world/tool/src/subscribable.ts`](../../../patchwork-tools/paper-world/tool/src/subscribable.ts),
   plus a Solid integration helper.
3. [Decisions](#decisions) and [Implementation plan](#implementation-plan).

## Where reactivity is missing

Two pieces of context every View depends on:

1. The **scope repo** — `el.closest("automerge-repo").repo`.
2. The **handle** for `el.handle`, derived from
   `(scope repo, doc=)`.

Each is computed once. Each can become stale.

### Scope repo (`el.repo`) goes stale

`mountView` reads `el.closest("automerge-repo").repo` once at
invocation ([`view.ts`](../../src/view.ts)). Triggers:

- **`<automerge-repo>.repo` swap** via `checkout` / `fork` / `reset`.
  Today `_rebuildDescendants` ([`view-registry.ts`](../../src/view-registry.ts))
  unmounts and remounts every view element in the scope; mitigates
  but is destructive and only handles things that *are* views.
- **Nested `<automerge-repo>` inheritance.** A nested marker captures
  the outer marker's `.repo` once, at insertion. If the outer
  swaps, the nested marker is stale forever — `_rebuildDescendants`
  only rebuilds views, not markers.
- **Element reparented** under a different `<automerge-repo>` scope.
- **A new `<automerge-repo>` inserted** between element and current
  ancestor.
- **Closures over `element.repo`** inside mount fns. Even when
  `_rebuildDescendants` runs, anything captured into an outer
  closure (Solid effect, event handler, callback) still references
  the old `BranchableRepo`.

### `el.handle` goes stale

`#resolveContext` resolves the URL against the closest
`<automerge-repo>` and stamps the result. Already reactive in two
narrow ways: the registry watches `doc=` and triggers
`#rebuildInstance`, and `BranchedDocHandle` swaps its inner handle on
COW while keeping outer identity stable. But:

- **Repo swap on the closest `<automerge-repo>`.** The handle was
  produced by `oldRepo.find(docUrl)`. After the swap, `newRepo` would
  produce a different `BranchedDocHandle`. Today fixed only by the
  destructive rebuild.
- **Element reparented** under a different `<automerge-repo>`. Not
  observed at all; `el.handle` keeps pointing at the old repo's view.
- **External update to the branch document's `clones` map** (e.g.
  another peer's COW). `BranchableRepo.find` looks up `clones` once
  at handle construction; an existing wrapped handle never re-checks.
- **Pinned-heads `doc=`** never re-pins on its own.

### Two orthogonal axes

It's useful to separate trigger from consumer, because the same
trigger affects multiple lookups:

| Trigger | Affects |
|---|---|
| `<automerge-repo>.repo` swap | `el.repo` and `el.handle` for every descendant View, nested marker inheritance |
| DOM reparent | scope repo, doc handle |
| External branch-doc `clones` map update | `BranchedDocHandle.#cloneHandle` selection |

| Consumer pattern | What it captures |
|---|---|
| Closure over `element.repo` / `element.handle` | one-shot reference inside callbacks, effects, event handlers |
| Solid effect calling the property | re-runs only when *Solid* dependencies change — the property's value isn't a Solid signal |

The framework's "answer" is a function of *(DOM structure, handle
contents, repo identity)*, and none of those are exposed as observable
inputs.

## Proposed shape: `Subscribable<T>`

The interface from
[`patchwork-tools/paper-world/tool/src/subscribable.ts`](../../../patchwork-tools/paper-world/tool/src/subscribable.ts):

```ts
type Subscribable<T> = {
  value(): T;
  subscribe(fn: (value: T) => void): () => void;
};
```

Two commitments: a synchronous `value()` for current state, and a
`subscribe` that fires immediately with the current value and on
every change, returning an unsubscribe.
[`Ref`](../../../patchwork-tools/paper-world/tool/src/ref.ts) and
[`PluginRegistry`](../../../patchwork-tools/paper-world/tool/src/plugins.ts)
both implement this, hiding *which* underlying signal fired (Automerge
`change`, repo swap, …) — consumers see only the derived value.

### Mapped onto `ViewRoot`

```ts
type ViewRoot<V = unknown> = HTMLElement & {
  handle: Subscribable<DocHandle<V> | undefined>;
  repo: Subscribable<BranchableRepo | undefined>;
};
```

And on the marker:

```ts
class AutomergeRepoElement extends HTMLElement {
  repo: Subscribable<BranchableRepo>;
}
```

Optionally on the wrapped handle, for "the active inner handle
changed" (COW or external clones-map update):

```ts
class BranchedDocHandle<T> {
  active: Subscribable<DocHandle<T>>;
  cloneUrl: Subscribable<AutomergeUrl | null>;
}
```

### What the consumer writes

Today (snapshot, frozen at mount time):

```js
export default async function (element) {
  const handle = element.handle;
  if (!handle) return;
  const doc = makeDocumentProjection(handle);
  // …
}
```

With `Subscribable`:

```js
export default function (element) {
  return render(() => {
    const handle$ = fromSubscribable(element.handle);
    const doc$ = createMemo(() => {
      const h = handle$();
      return h ? makeDocumentProjection(h) : null;
    });
    return html`<button>count: ${() => doc$()?.count ?? 0}</button>`;
  }, element);
}
```

`handle$` re-fires when the element is reparented under a different
`<automerge-repo>` or the closest marker's `.repo` swaps; `doc$`
invalidates with it; `makeDocumentProjection(h)` re-runs against the
new handle.

### What this gets, by case

| Failure mode | How it surfaces |
|---|---|
| `<automerge-repo>.repo` swap | marker's `repo` re-fires; descendants' `el.repo` and `el.handle` re-fire |
| Element reparented under different `<automerge-repo>` | `el.repo` re-fires; `el.handle` re-fires (re-resolved against new repo) |
| Nested `<automerge-repo>` inheritance | nested marker's `repo` is itself derived from its parent chain |
| Branch doc `clones` map externally updated | `BranchedDocHandle.active` re-fires |
| Closure-level captures | n/a — consumers always read through `subscribe`/`value()` |

Every entry collapses into "this Subscribable re-fires"; the consumer
doesn't need to know which underlying primitive triggered it.

### Underlying-vs-derived split

`Subscribable<T>` draws a line between **primitives** (the things the
framework observes internally) and **derived values** (what consumers
see). The consumer doesn't think about *why* a value changed — just
that it changed.

Primitives the framework would observe:

- DOM parent-chain mutations.
- `<automerge-repo>.repo` swaps.
- Per-element `el.handle` resolution.
- Per-handle `change` events.

Derived values consumers see:

- `el.handle`, `el.repo`, `automergeRepoEl.repo`,
  `branchedDocHandle.active`.

Each derived value internally subscribes to whichever primitives it
needs.

## Solid integration

Two helpers — one for reference values, one for collections that
benefit from fine-grained updates.

```ts
import { createSignal, onCleanup, type Accessor } from "solid-js";
import { createStore, reconcile, type Store } from "solid-js/store";
import type { Subscribable } from "@patchwork-tools/...";

// References / primitives — === dedup, signal semantics.
export function fromSubscribable<T>(s: Subscribable<T>): Accessor<T> {
  const [v, setV] = createSignal<T>(s.value());
  onCleanup(s.subscribe(setV));
  return v;
}

// Objects / arrays — fine-grained updates via reconcile.
export function fromSubscribableStore<T extends object>(
  s: Subscribable<T>,
  options?: Parameters<typeof reconcile>[1],
): Store<T> {
  const [store, setStore] = createStore<T>(s.value());
  onCleanup(
    s.subscribe((next) =>
      setStore(reconcile(next, options) as never),
    ),
  );
  return store;
}
```

The split mirrors Solid's own — signals for *one thing*, stores for
*many things*.

### Why the helper is small

Three things make it Just Work:

- `Subscribable.subscribe(fn)` already fires synchronously with the
  current value. The redundant initial call hits Solid's `===` dedup
  and is a no-op.
- `onCleanup` ties the unsubscribe to the surrounding reactive scope
  — the same scope that runs the view's mount-fn cleanup.
- The framework dedups inside the `Subscribable` (e.g. don't fire if
  the value didn't change), so by the time it reaches Solid, redundant
  fires are gone.

### When `reconcile` matters

`fromSubscribable` re-fires every dependent computation whenever the
*identity* of the value changes. `reconcile` shines for **nested
objects where consumers track fields**:

```ts
// Hypothetical: framework exposes branch doc as a Subscribable.
const branch = fromSubscribableStore(repo.branchHandle);

createEffect(() => {
  // Re-runs only when `name` changes, not when an unrelated
  // `clones` entry appears.
  console.log(branch.name);
});
```

Without `reconcile`, the whole `BranchDoc` would be replaced on every
emission and every effect reading any field would re-run.

### Two layers of dedup

The framework's `Subscribable` impl dedups *whether to notify*;
`createStore` + `reconcile` dedups *what to update inside a
notification*. They stack:

1. Framework `Subscribable`: avoid notifying when the value didn't
   change. Coarse — by reference for scalars, shallow-equal for
   arrays of references.
2. `createStore` + `reconcile`: when a notification *does* arrive
   with new content, only update the parts of the store that
   actually differ.

A subtle thing: `Subscribable.subscribe(fn)` fires synchronously on
subscribe. With `reconcile`, that initial fire triggers
`setStore(reconcile(initial))` against a store that was *just*
initialized to the same `initial`. The diff sees no change and is a
no-op.

## Decisions

Committed answers to the design choices the `Subscribable<T>` shape
doesn't pre-decide. Skim before implementing; revisit only with
cause.

1. **What "reconcile" means.** Re-derive context, fire
   `Subscribable`s. The mount fn runs once; everything dynamic flows
   through subscriptions. HMR and `doc=` rebuild are *element
   replacement*, not reconcile.
2. **Pure subscribables for `el.handle` / `el.repo`.** No
   snapshot/subscribable hybrid. `el.handle` is a stable
   `Subscribable<DocHandle>` whose underlying handle fires `change`
   on edits *and* on branch swaps — branching is invisible to
   consumers.
3. **Equality dedup.** Framework owns dedup; consumers trust it.
   Reference for scalars/objects, shallow for arrays.
4. **Teardown.** Solid `onCleanup` for code inside `render(...)`;
   tiny manual collector for non-Solid mount fns. No dedicated
   helper.
5. **Composition primitive.** Use Solid memos under a long-lived
   root. No custom `derived` helper. A `toSubscribable(accessor)`
   adapter at the API edge converts memos to `Subscribable<T>`.
6. **Lazy listeners.** Per-handle Automerge `change` listeners
   attached lazily (only while subscribed). Singleton primitives
   (`MutationObserver`) are eager.
7. **Async abort discipline.** Per-mount generation counter (closure
   variable in `mountView`), checked after each `await` in
   context resolution. No `AbortController`. Internal only; consumers
   don't see it.
8. **Propagation order.** Single microtask, top-down via Solid's
   scheduler. Memos settle before dependent effects in the same
   batch. Cycles guarded by Solid's "already computing" check; the
   framework derived graph is acyclic by construction.
9. **Migration.** Flag day. Snapshots removed in the same PR they're
   migrated off of. No parallel APIs.
10. **Helper packaging.** `Subscribable<T>` stays in
    `@patchwork-tools/paper-world/tool` (no Solid dep). New sibling
    package `@patchwork-tools/paper-world/solid` exports
    `fromSubscribable`, `fromSubscribableStore`, `toSubscribable`.
    `overlock-patchwork` depends on both.

## Implementation plan

Two phases, each landing as one PR.

### Phase 1 — Plumbing

Adds the reactive substrate without changing `ViewRoot`'s public
surface yet. After this lands, the snapshot APIs still work; nothing
internal is ported.

- **New sibling package `@patchwork-tools/paper-world/solid`.**
  Depends on `solid-js` and the tool package. Exports:
  - `fromSubscribable<T>(s) → Accessor<T>`
  - `fromSubscribableStore<T>(s, options?) → Store<T>`
  - `toSubscribable<T>(accessor) → Subscribable<T>` (memo →
    subscribable, used by the framework, not consumers)
- **Long-lived Solid root** owned by `overlock-patchwork` (e.g.
  `src/reactive-root.ts`). Created once at boot, never disposed;
  hosts every framework-internal memo.

### Phase 2 — Subscribable surface (flag day)

Replaces every snapshot lookup with a `Subscribable`. Internal
callsites and `packages/root/component.js` migrate in the same PR.

- **`AutomergeRepoElement`**
  - `repo: Subscribable<BranchableRepo>` — driven by
    `checkout` / `fork` / `reset`.
  - Nested-marker inheritance becomes a memo derived from the outer
    marker's `repo` plus this marker's own attributes.
- **`View` / `ViewRoot`**
  - `handle: Subscribable<DocHandle | undefined>` — memo over
    `(closest marker.repo, doc=)`. Generation-counter guards the
    async `repo.find()`.
  - `repo: Subscribable<BranchableRepo | undefined>` — closest
    marker's `repo`, re-resolved on DOM reparent and marker insert.
- **`BranchedDocHandle`** — forward `change` from the active inner
  handle and re-fire on inner-handle swap (branch switch / COW). The
  wrapper is the stable identity. Optional `active:
  Subscribable<DocHandle>` for consumers that want to observe
  branch-swap specifically.
- **Removed**:
  - `_rebuildDescendants` destructive remount.
  - Snapshot-stamped `el.handle` / `el.repo`.

### Out of scope for this plan

- Performance optimizations beyond per-value dedup. Land later, driven
  by a profile.
- An exposed `Subscribable<DocShape>` for Automerge document
  content (`fromSubscribableStore` on the doc itself). Wait until a
  consumer asks.
