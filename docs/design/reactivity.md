# Reactive context

> **Status: design sketch, not implemented.** The behavior described
> here is a target shape, not what the code does today. See
> [`docs/README.md`](../README.md) for the actual architecture and
> [`design/README.md`](./README.md) for what this folder is.

Components depend on context derived from their position in the DOM:
the closest matching ancestor, the children under them, the scope
repo, the resolved doc handle, the schema-parse verdict against an
ancestor's doc. All of this is read once today and either returned to
the caller as a snapshot or stamped onto the element as a property.
Many things can change after that read without any signal back to the
consumer.

This note is in three parts:

1. [Where reactivity is missing](#where-reactivity-is-missing) — a
   characterization of the failure modes by trigger and by consumer.
2. [Why mount/unmount events alone aren't enough](#why-mountunmount-events-alone-arent-enough) —
   the natural first reach, and what it covers vs. doesn't.
3. [Proposed shape: `Subscribable<T>`](#proposed-shape-subscribablet) —
   borrowing the interface from
   [`patchwork-tools/paper-world/tool/src/subscribable.ts`](../../../patchwork-tools/paper-world/tool/src/subscribable.ts),
   plus a Solid integration helper.

Decisions made about the open design choices live in
[Decisions](#decisions) at the end, and the rollout is sketched in
[Implementation plan](#implementation-plan).

## Where reactivity is missing

There are five pieces of context every Component depends on:

1. The **ancestor component** chain
   (`el.closestComponent` / `el.ancestorComponent`).
2. The **descendant component** set (`el.componentChildren`).
3. The **scope repo** — `el.closest("automerge-repo").repo`.
4. The **handle** for `el.handle`, derived from
   `(scope repo, doc=)`.
5. The **schema match** verdict, derived from
   `handle.doc()` parsed through a consumer-supplied schema.

Each of these is computed once. Each can become stale. The triggers
fall into seven groups:

### Ancestor lookup goes stale

Used by `closestComponent` / `ancestorComponent`
([`src/components/ancestor-lookup.ts`](../../src/components/ancestor-lookup.ts)).
A walker over `parentElement` + `componentStore` returns a snapshot.
Things that move the answer afterward:

- **Parent's `handle` resolves later.** `#resolveContext` is async
  ([`component-registry.ts`](../../src/components/component-registry.ts)),
  so under schema filtering a parent that's still resolving is
  skipped; once `el.handle` lands the walker would now match.
- **Parent's `doc=` rebuild.** `#handleDocAttributeChange` tears down
  + recreates the parent element; the captured `ComponentRoot`
  reference is now detached.
- **Parent's `handle.doc()` content changes.** Schema-parse can flip
  pass↔fail when an Automerge patch arrives. The walker only
  evaluated at call time.
- **DOM reparenting** of the consumer or any ancestor.
- **A new wrapping ancestor inserted** between consumer and
  previously-matched ancestor.
- **An ancestor unmounting.** `componentStore.lookup` returns
  `undefined`, the walk skips it.
- **Pre-bootstrap `<patchwork-view>` ancestor** — currently *not
  visited* by the ancestor walker. A child whose parent is still
  bootstrapping doesn't see it as an ancestor at all.

### Descendant lookup goes stale

Used by `componentChildren` (same file). Walks descendants, treats
`<patchwork-view>` as a boundary even pre-swap. Triggers:

- **Children added later** — provider's snapshot misses them.
- **Children removed / unmounted** — snapshot includes detached
  elements.
- **Children reparented** out of the provider subtree.
- **`<patchwork-view>` → real-tag swap** — boundary element identity
  changes; previous reference is the old, disconnected
  `<patchwork-view>`.
- **Schema-filtered child appears.** Pre-swap `<patchwork-view>`s
  are skipped under schema filtering; once their `handle` resolves
  they'd match.
- **Child's `handle.doc()` content change** — schema flip.
- **Child's `doc=` rebuild** — element identity changes.

### Scope repo (`el.repo`) goes stale

`stampLookups` reads `el.closest("automerge-repo").repo` once at
Component construction
([`ancestor-lookup.ts`](../../src/components/ancestor-lookup.ts)).
Triggers:

- **`<automerge-repo>.repo` swap** via `checkout` / `fork` / `reset`.
  Today `_rebuildDescendants` ([`component-registry.ts`](../../src/components/component-registry.ts))
  unmounts and remounts every Component in the scope; mitigates but
  is destructive and only handles things that *are* Components.
- **Nested `<automerge-repo>` inheritance.** A nested marker captures
  the outer marker's `.repo` once, at insertion. If the outer
  swaps, the nested marker is stale forever — `_rebuildDescendants`
  only rebuilds Components, not markers.
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

### Schema-match verdict goes stale

`schema.parse(handle.doc())` is called inside the walker; the verdict
can flip without anyone noticing. Doc content changes (local or
remote), handle COW on the branch, repo swap.

### `componentStore` is not observable

[`component-store.ts`](../../src/components/component-store.ts) is a
plain `WeakMap`. No event channel for "an ancestor of mine just
registered / unregistered". This is the underlying primitive that
makes most of the cases above hard.

### HMR rebuild cascades silently

`#hmrReload` and `#handleDocAttributeChange` both go through
`#rebuildInstance`. From a child's perspective, its parent's element
identity just changed underneath it; none of the child's
`closestComponent` results, closures, or subscriptions get notified.
The child itself isn't rebuilt.

### Two orthogonal axes

It's useful to separate trigger from consumer, because the same
trigger affects multiple lookups:

| Trigger | Affects |
|---|---|
| Ancestor's `doc=` rebuild | ancestor chain identity, captured `ComponentRoot` refs |
| Ancestor's `handle.doc()` change | schema-match verdict |
| `<automerge-repo>.repo` swap | `el.repo` and `el.handle` for every descendant Component, nested marker inheritance |
| DOM reparent / structural insert | scope repo, ancestor chain, descendant chain |
| Pre-bootstrap → swap transition | descendant snapshots, ancestor visibility for already-mounted children |
| External branch-doc `clones` map update | `BranchedDocHandle.#cloneHandle` selection |
| Component unmount in the chain | ancestor visibility, descendant visibility |

| Consumer pattern | What it captures |
|---|---|
| `const x = el.closestComponent(s)` at mount-time | one-shot, frozen reference |
| `for (const c of el.componentChildren()) ...` | one-shot list |
| Closure over `element.repo` / `element.handle` | one-shot reference inside callbacks, effects, event handlers |
| Solid effect calling the lookup | re-runs only when *Solid* dependencies change — the lookup's result isn't a Solid signal |

The framework's "answer" is a function of *(DOM structure,
componentStore contents, handle contents, repo identity)*, and none
of those four are exposed as observable inputs.

## Why mount/unmount events alone aren't enough

The natural first reach is "let `Component` fire a `mounted` /
`unmounted` event so consumers can re-walk". This solves a real
subset, but it's a smaller subset than it looks.

### Direction matters

A useful split: are the events bus events on `componentStore`, or
DOM events dispatched on the element itself?

- **DOM events bubble *up* through the parent chain.** They naturally
  let a parent observe its descendants (the provider pattern is a
  perfect fit). They don't naturally let a child observe its
  ancestors — a new ancestor's `mounted` event fires *on the
  ancestor*, bubbles to *its* ancestors, never reaches the descendant.
- **Bus events on `componentStore`** require every consumer to filter
  by direction themselves ("is this Component an ancestor of mine?
  in my subtree?"), but cover both directions equally.

The original `ancestor-lookup.ts` problem is the *child observing
ancestors* direction, which DOM-bubbling events get structurally
wrong. The escape hatch — capture-phase listeners on `document` — is
just a global bus with extra steps.

### What mount/unmount events solve

Either form covers the membership-changing cases:

- Parent's `doc=` rebuild → child re-walks (the unmount and mount
  fire as part of `#rebuildInstance`'s teardown + recreate).
- Ancestor or descendant Component unmount.
- HMR rebuild cascade.
- `<automerge-repo>.repo` swap *for descendant Components* — today
  `_rebuildDescendants` unmounts/remounts each one, so events fire
  per descendant.
- A new wrapping ancestor *Component* inserted (in the bus form;
  half-reactive in the DOM-bubbling form).

### What they don't solve

Everything else, which is most of the list:

- **`el.handle` resolves *after* `mounted`.** `Component` registers
  in the constructor synchronously, then `#resolveContext` runs and
  stamps `el.handle` afterward. `mounted` already fired. Schema
  walks against a parent that's mid-resolve don't get a second
  chance unless there's a separate "handle-resolved" event.
- **`handle.doc()` content changes flipping the schema verdict.**
  Same Component is registered the whole time; only its content
  moved across the schema boundary.
- **Branch document `clones` map externally updated.** Content
  change, no membership change.
- **Pure DOM reparenting.** The Component is alive throughout; only
  `parentElement` changed. No mount/unmount fires on a move.
- **Element reparented under a different `<automerge-repo>` scope.**
  Same — no membership change.
- **A new `<automerge-repo>` marker inserted.** Markers aren't
  Components; they don't fire mount/unmount.
- **Nested `<automerge-repo>` inheritance going stale** when the
  outer marker's `.repo` swaps. Same reason.
- **`<patchwork-view>` insertion in a provider's subtree.** No
  Component exists yet → no `mounted` fires until bootstrap completes,
  which is *after* `#resolveContext` has already read `doc=`. The
  provider's window to write `doc=` has closed by the time the event
  arrives.
- **Repo swap during the `repo.find(docUrl)` await** in
  `#resolveContext`. Async race, not membership-driven.
- **Closure-level captures.** Whether the framework signals via DOM
  events or a bus, anything captured into a closure
  (`const x = el.closestComponent(s)`) doesn't rebind on its own.

The shape: mount/unmount events solve "Component identity changed
under me", not "the world around the Component changed without
changing its identity" — which covers most of the interesting failure
modes.

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
`change`, filesystem watcher, schema-filter result) — consumers see
only the derived value.

### Mapped onto `ComponentRoot`

```ts
type ComponentRoot<V = unknown> = HTMLElement & {
  handle: Subscribable<DocHandle<V> | undefined>;
  repo: Subscribable<BranchableRepo | undefined>;
  closestComponent<T>(s: Schema<T>):
    Subscribable<SchemaComponentRoot<T> | null>;
  ancestorComponent():
    Subscribable<ComponentRoot | null>;
  ancestorComponent<T>(s: Schema<T>):
    Subscribable<SchemaComponentRoot<T> | null>;
  componentChildren():
    Subscribable<ComponentRoot[]>;
  componentChildren<T>(s: Schema<T>):
    Subscribable<SchemaComponentRoot<T>[]>;
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
  const counter = element.closestComponent(counterSchema);
  if (!counter) return;
  const doc = makeDocumentProjection(counter.handle);
  // …
}
```

With `Subscribable`:

```js
export default async function (element) {
  const unsubscribe = element
    .closestComponent(counterSchema)
    .subscribe((counter) => {
      if (!counter) {
        renderPlaceholder();
        return;
      }
      renderAgainst(counter.handle);
    });
  return unsubscribe;
}
```

The provider pattern from
[`documents.md`](../documents.md#context-provider-components):

```js
export default function (element) {
  return render(() => {
    const account$ = fromSubscribable(
      element.closestComponent(accountSchema),
    );
    const children$ = fromSubscribable(element.componentChildren());

    const doc$ = createMemo(() => {
      const a = account$();
      return a ? makeDocumentProjection(a.handle) : null;
    });

    createEffect(() => {
      const url = doc$()?.rootFolderUrl;
      if (!url) return;
      for (const child of children$()) {
        if (child.getAttribute("doc") !== url) {
          child.setAttribute("doc", url);
        }
      }
    });
  }, element);
}
```

`account$` re-fires when the ancestor flips (rebuild, schema-flip,
reparent, repo swap); `doc$` invalidates with it;
`makeDocumentProjection(a.handle)` re-runs against the new handle.
That's exactly what the original problem needed.

### What this gets, by case

| Failure mode | How it surfaces |
|---|---|
| Parent's `doc=` rebuild | `closestComponent(...)` re-fires |
| Ancestor unmount | `closestComponent(...)` re-fires with `null` or next match up |
| New wrapping ancestor inserted | `closestComponent(...)` re-fires with the closer match |
| Ancestor's `handle` resolved later | `closestComponent(schema)` re-fires when schema parse starts succeeding |
| Ancestor's `handle.doc()` schema-flips | `closestComponent(schema)` re-fires |
| Element reparented under different `<automerge-repo>` | `el.repo` re-fires; `el.handle` re-fires (re-resolved against new repo) |
| `<automerge-repo>.repo` swap | marker's `repo` re-fires; descendants' `el.repo` and `el.handle` re-fire |
| Nested `<automerge-repo>` inheritance | nested marker's `repo` is itself derived from its parent chain |
| New child Component | `componentChildren()` re-fires |
| Pre-bootstrap `<patchwork-view>` insertion | `componentChildren()` re-fires |
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

- `componentStore` mount/unmount.
- DOM parent-chain mutations.
- `<automerge-repo>.repo` swaps.
- Per-element `el.handle` resolution.
- Per-handle `change` events.

Derived values consumers see:

- `el.handle`, `el.repo`,
  `el.closestComponent(s)`, `el.ancestorComponent(...)`,
  `el.componentChildren(s?)`, `automergeRepoEl.repo`,
  `branchedDocHandle.active`.

Each derived value internally subscribes to whichever primitives it
needs. The choice is mirrored in `PluginRegistry.byType(type)`: a
filtered `Subscribable<Plugin[]>` derived from the all-view, presented
to consumers as just another `Subscribable`.

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
  — the same scope that runs the component's mount-fn cleanup.
- The framework dedups inside the `Subscribable` (e.g. don't fire if
  the `closestComponent` answer didn't change), so by the time it
  reaches Solid, redundant fires are gone.

### When `reconcile` matters

`fromSubscribable` re-fires every dependent computation whenever the
*identity* of the value changes. For an array, that's every emission,
which would re-run any effect reading the array. `<For each={…}>`
already does its own `===`-keyed diff internally, so for plain
rendering of `Subscribable<ComponentRoot[]>` you can use
`fromSubscribable` + `<For>` and get item-level mount/unmount for
free.

`reconcile` shines for **nested objects where consumers track
fields**:

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

### Key choice for arrays

`reconcile` matches items by a `key` property (default `"id"`) before
falling back to structural diff. For our concrete shapes:

- **`componentChildren()` → `ComponentRoot[]`.** Items are
  `HTMLElement`s with no `id` field. Use `fromSubscribable` + `<For>`
  (which keys by `===`) instead of `fromSubscribableStore` —
  simplest and correct.
- **String-keyed maps** (clones map, name table). `reconcile` with
  default options works.
- **Document-shaped objects** (manifests, branch docs, anything
  pulled out of Automerge). Sweet spot — `fromSubscribableStore`
  with `key: "id"` or `key: null` depending on shape.

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
3. **Caching of derived subscribables.** Per-element
   `Map<Schema, Subscribable>` (e.g. for `closestComponent(schema)`).
   Element ref owns the cache; no separate id needed.
4. **Equality dedup.** Framework owns dedup; consumers trust it.
   Reference for scalars/objects, shallow for arrays.
5. **Teardown.** Solid `onCleanup` for code inside `render(...)`;
   tiny manual collector for non-Solid mount fns. No dedicated
   helper.
6. **Composition primitive.** Use Solid memos under a long-lived
   root. No custom `derived` helper. A `toSubscribable(accessor)`
   adapter at the API edge converts memos to `Subscribable<T>`.
7. **Lazy listeners.** Per-handle Automerge `change` listeners
   attached lazily (only while subscribed). Singleton primitives
   (`MutationObserver`, `componentStore` events) are eager.
8. **Bottom-up firing scope.** Only structural (membership) changes
   need it. `Component.connectedCallback` /
   `disconnectedCallback` walk up to the nearest Component ancestor
   and ping its `componentChildren()`. Content axes propagate through
   each element's own exposed subscribables — no bottom-up.
9. **Async abort discipline.** Per-`Component` generation counter,
   checked after each `await` in context resolution. No
   `AbortController`. Internal only; consumers don't see it.
10. **Propagation order.** Single microtask, top-down via Solid's
    scheduler. Memos settle before dependent effects in the same
    batch. Cycles guarded by Solid's "already computing" check; the
    framework derived graph is acyclic by construction.
11. **Migration.** Flag day. Snapshots removed in the same PR they're
    migrated off of. No parallel APIs.
12. **Helper packaging.** `Subscribable<T>` stays in
    `@patchwork-tools/paper-world/tool` (no Solid dep). New sibling
    package `@patchwork-tools/paper-world/solid` exports
    `fromSubscribable`, `fromSubscribableStore`, `toSubscribable`.
    `overlock-patchwork` depends on both.

## Implementation plan

Three phases, each landing as one PR. The simple-and-correct version
ships in phases 1–2; performance work is explicitly out of scope
until a profile asks for it.

### Phase 1 — Plumbing

Adds the reactive substrate without changing `ComponentRoot`'s
public surface yet. After this lands, the snapshot APIs still work;
nothing internal is ported.

- **New sibling package `@patchwork-tools/paper-world/solid`.**
  Depends on `solid-js` and the tool package. Exports:
  - `fromSubscribable<T>(s) → Accessor<T>`
  - `fromSubscribableStore<T>(s, options?) → Store<T>`
  - `toSubscribable<T>(accessor) → Subscribable<T>` (memo →
    subscribable, used by the framework, not consumers)
- **Long-lived Solid root** owned by `overlock-patchwork` (e.g.
  `src/components/reactive-root.ts`). Created once at boot, never
  disposed; hosts every framework-internal memo.
- **Singleton `MutationObserver`** at `document` watching `childList`
  mutations. Fans out into per-element structural notifications.
- **`componentStore` register/unregister hooks.** On
  `connectedCallback` / `disconnectedCallback`, walk from the element
  up to its nearest Component ancestor and ping that ancestor's
  `componentChildren()` source.

### Phase 2 — Subscribable surface (flag day)

Replaces every snapshot lookup with a `Subscribable`. Internal
callsites and `packages/root/component.js` migrate in the same PR.

- **`AutomergeRepoElement`**
  - `repo: Subscribable<BranchableRepo>` — driven by
    `checkout` / `fork` / `reset`.
  - Nested-marker inheritance becomes a memo derived from the outer
    marker's `repo` plus this marker's own attributes.
- **`Component` / `ComponentRoot`**
  - `handle: Subscribable<DocHandle | undefined>` — memo over
    `(closest marker.repo, doc=)`. Generation-counter guards the
    async `repo.find()`.
  - `repo: Subscribable<BranchableRepo | undefined>` — closest
    marker's `repo`, re-resolved on DOM reparent and marker insert.
  - `closestComponent<T>(s)` / `ancestorComponent(s?)` — memos;
    cached per element via `Map<Schema, Subscribable>`.
  - `componentChildren<T>(s?)` — memo over a structural source plus
    per-child `matches(s)`.
  - `matches<T>(s): Subscribable<boolean>` — exposed publicly so
    parents can filter children without reaching into a child's doc.
- **`BranchedDocHandle`** — forward `change` from the active inner
  handle and re-fire on inner-handle swap (branch switch / COW). The
  wrapper is the stable identity. Optional `active:
  Subscribable<DocHandle>` for consumers that want to observe
  branch-swap specifically.
- **Removed**:
  - `_rebuildDescendants` destructive remount.
  - Snapshot-stamped `el.handle` / `el.repo`.
  - `ancestor-lookup.ts` synchronous walker (logic moves into the
    derived memos).
- **Migration**:
  - All `src/` consumers switch to subscribable form.
  - `packages/root/component.js` rewritten to `render(() => { … })`
    + `fromSubscribable`.

### Phase 3 — Cleanup / docs

- Strip dead code paths surfaced by phase 2.
- Update this doc's status from "design sketch" to "implemented".
- Update [`docs/README.md`](../README.md) file map if module layout
  changed.
- Smoke tests covering the headline failure modes:
  - branch switch propagates to consumers without re-subscribe;
  - structural insertion of `<patchwork-view>` shows up in
    `componentChildren()`;
  - ancestor `doc=` rebuild flips `closestComponent(schema)`.

### Out of scope for this plan

- Performance optimizations beyond per-value dedup (subtree pruning,
  schema-verdict cache by `heads`, ancestor-walk memoization). Land
  these later, driven by a profile.
- An exposed `Subscribable<DocShape>` for Automerge document
  content (`fromSubscribableStore` on the doc itself). Wait until a
  consumer asks.
- Cycle assertion in tests — add when there's a credible risk; the
  current derivation graph is acyclic by construction.
