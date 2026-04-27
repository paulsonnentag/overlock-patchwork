# Documents

Components opt into Automerge documents in two complementary ways: by
asking the *repo* itself (e.g. to create a new doc) and by receiving a
`DocHandle` to an *existing* doc. Both go through the
`<automerge-repo>` scope marker.

For the lifecycle around `el.handle` resolution and the rebuild on
attribute change see [`lifecycle.md`](./lifecycle.md).

## `<automerge-repo>` — repo scope

Wrap any subtree that should resolve doc handles in `<automerge-repo>`:

```html
<automerge-repo>
  <patchwork-view src="automerge:.../my-app/component.json"></patchwork-view>
</automerge-repo>
```

`<automerge-repo>` is a no-op marker tag. The registry walks the
subtree on construction (and on every `MutationObserver` insertion)
and assigns `el.repo = registry.repo` to each one. Components reach
the repo with:

```js
const repo = element.closest("automerge-repo")?.repo;
```

The repo is a `BranchableRepo` — a thin forkable wrapper around an
Automerge `Repo`. While unbranched, every method delegates straight
to the underlying repo, so `repo.find(...)` / `repo.create(...)` work
exactly as if you had a raw `Repo`. See [Branching](#branching) below
for how to fork a repo and walk a branch's handles.

There is exactly one repo wrapper in the page today — the global one
set up in [`src/main.ts`](../src/main.ts) — so the marker is mostly a
future-proofing boundary. Component mount fns should read the repo via
`element.repo`, which the registry stamps on every component element
from the closest `<automerge-repo>` ancestor:

```js
const repo = element.repo;
if (!repo) {
  // Outside any <automerge-repo> ancestor — handle gracefully.
}
```

`element.repo` is set synchronously when the component element is
constructed, so it's available the moment the mount fn runs. Whether
that maps to a global, per-tree, or per-component repo is the registry's
business; mount fns just read the property.

## `doc=` attribute on `<patchwork-view>`

Set `doc=` to an `automerge:...` URL to ask the registry for a
`DocHandle` to that document before your mount fn runs:

```html
<automerge-repo>
  <patchwork-view
    doc="automerge:..."
    src="automerge:.../counter/component.json"
  ></patchwork-view>
</automerge-repo>
```

The registry resolves the URL against the closest `<automerge-repo>`,
awaits `repo.find(url)`, and stamps the resulting handle onto the
swapped element as a JS property (`el.handle`). The mount fn picks it
up directly:

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

`doc=` is strict: present without an `<automerge-repo>` ancestor, the
mount is aborted with an error. Absent, `el.handle` stays `undefined`
and the component runs as before — `clock` does this and just renders
local state.

## Looking up ancestor and child components

Every mounted component element exposes ancestor- and descendant-walking
helpers, stamped onto the element by `Component`'s constructor. They let a
child read context out of an enclosing component, and let a parent
enumerate its child components, without any framework-level prop drilling:

```ts
type Schema<T> = {
  init(): T;
  parse(value: unknown): T;
};

el.closestComponent<T>(schema: Schema<T>):    SchemaComponentRoot<T> | null;
el.ancestorComponent():                       ComponentRoot | null;
el.ancestorComponent<T>(schema: Schema<T>):   SchemaComponentRoot<T> | null;
el.componentChildren():                       ComponentRoot[];
el.componentChildren<T>(schema: Schema<T>):   SchemaComponentRoot<T>[];
```

- `closestComponent(schema)` — walks **self → parent → …**. For each
  registered component along the way, calls `schema.parse(handle.doc())`;
  returns the first hit. Ancestors with no `handle` (no `doc=`) and
  ancestors whose doc fails to parse are skipped. Returns `null` if
  nothing matches.
- `ancestorComponent()` — walks **parent → …** and returns the first
  registered component, regardless of whether it has a `handle`. The
  no-schema form is for "give me my enclosing component, whatever it is".
- `ancestorComponent(schema)` — same walk but applied with the parse
  filter. Skip-self version of `closestComponent`.
- `componentChildren()` — walks descendants, **stops at every component
  boundary**, and returns the nearest-component descendants. A child
  counts as a boundary if it has a registered `Component` (already
  swapped) or its tag is `<patchwork-view>` (still bootstrapping). Both
  shapes are reported, so consumers can act on the full set immediately
  without waiting for in-flight bootstraps. Wrapping non-component
  elements (a `<div>`, a `<header>`, …) are descended into transparently.
- `componentChildren(schema)` — same walk with the parse filter.
  Pre-swap `<patchwork-view>`s have no `handle` yet and are skipped under
  schema filtering.

`componentChildren` is the building block for **context-provider
components**: a parent walks its component children once at mount, plus
again from inside a reactive scope when the value to propagate changes,
and writes `setAttribute("doc", url)` on each. The registry then handles
the rest via the `doc=` rebuild path (see "Reactive `doc=`" below).

Matching is **purely structural**: components don't register their schema
with the framework, so any ancestor whose doc parses under the consumer's
schema is a hit. Two consumers using two duck-equivalent schemas will see
each other's components.

`Schema<T>` is duck-typed so authors can pick whichever validation
library they like. A Zod adapter:

```js
import { z } from "https://esm.sh/zod@3.23.8";

const shape = z.object({ count: z.number() });

export const counterSchema = {
  init: () => ({ count: 0 }),
  parse: (value) => shape.parse(value),
};
```

`init()` is for the *consumer's* use — typically when bootstrapping a
fresh document — and is never called by the framework.

A child component reading the count out of a counter ancestor:

```js
import { counterSchema } from "./schema.js";

export default async function (element) {
  const counter = element.closestComponent(counterSchema);
  if (!counter) {
    throw new Error("counter-readout requires a counter ancestor");
  }
  const handle = counter.handle; // DocHandle<{ count: number }>
  // … render handle.doc().count, subscribe to handle.on("change"), etc.
}
```

### Race against `doc=` resolution

`el.handle` is set asynchronously by the registry's `#resolveContext`
step. Tree-order construction guarantees a parent component is
*registered* in `componentStore` before any of its children, so the
walker always finds the parent — but the parent's `handle` may not yet
be set when a child's mount fn first runs. Under schema filtering, a
parent without a `handle` is skipped, so the lookup may miss a parent
that's still resolving.

The lookup is a synchronous snapshot, like `el.handle` itself. If the
ancestor's doc is critical, call the lookup from inside a reactive
scope (Solid effect, etc.) so it re-runs once the parent's handle
resolves, or schedule the call after the relevant async work has
settled.

## Reactive `doc=`

The `MutationObserver` watches `doc` attribute changes on every
element in its tree (`{ attributes: true, attributeFilter: ["doc"] }`).
When the attribute changes on a *mounted* component, the registry
rebuilds the instance under the same tag name and mount fn — same
teardown + recreate dance as HMR (see
[`lifecycle.md`](./lifecycle.md)). The new element's `el.handle`
reflects the new URL; the component's cleanup runs between the old
and new mount.

A change to `doc=` on a `<patchwork-view>` *before* bootstrap completes
is picked up naturally — bootstrap reads the attribute when it
resolves the context, and an in-flight resolve is just superseded by
the rebuild.

## Branching

`element.repo` is a `BranchableRepo`, which adds three things on top
of a plain Automerge `Repo`:

```ts
repo.fork(urls?: AutomergeUrl[]): Promise<BranchableRepo>
repo.checkout(branchDocUrl: AutomergeUrl): Promise<BranchableRepo>
repo.branchHandle: DocHandle<BranchDoc> | null
```

A *branch* is just another Automerge document that records a map of
`{ originalUrl → cloneUrl }`. The clone url has its `?heads=` segment
set to the heads of the original at the moment the clone was created
(the *fork point*). `Repo.clone` shares history with the original, so
those heads are valid heads inside the clone too — which is what makes
diffing cheap.

`fork()` returns a *new* `BranchableRepo`; the receiver is unchanged.
The new repo's `find()` returns proxy handles that stay live on the
original document until you write to them. The first
`handle.change(...)` triggers a copy-on-write clone of the underlying
doc, and from that point on the proxy is backed by the clone:

```js
const branched = await element.repo.fork();
const handle = await branched.find(originalUrl);

handle.url;                        // still the *original* url
handle.doc();                      // reads from the original
handle.change(d => d.title = "x"); // first write — clones, branch doc updated
handle.diff();                     // patches from forkHeads → current
```

Pass urls to `fork(urls)` to clone them eagerly at fork time. URLs
may include a `?heads=` segment to fork at a point in time:

```js
const branched = await element.repo.fork([
  "automerge:abc...",                  // current heads
  "automerge:def...?heads=g1,g2",      // historical heads
]);
```

`branched.branchHandle` is a `DocHandle<BranchDoc>` whose url you can
hand to `BranchableRepo.checkout(repo, branchDocUrl)` later to reopen
the branch.

`handle.diff()` (no args) returns the patches between the fork point
and the branch's current heads, or `[]` before the first COW or
off-branch. The two-arg form delegates to the underlying
`DocHandle.diff(first, second?)`.

Branch-native documents — those created via `branched.create({...})`
on a branched repo — live on the underlying repo and are not tracked
in the branch's `clones` map; they have no original to fork from.

Forking a branched repo (`branched.fork()`) currently throws —
nested branching will be added later.

See [`src/branchable-repo.ts`](../src/branchable-repo.ts) for the
implementation.
