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

There is exactly one `Repo` in the page today — the global one set up
in [`src/main.ts`](../src/main.ts) — so the marker is mostly a
future-proofing boundary. Resolving `closest("automerge-repo")` is
the single API; whether that maps to a global, per-tree, or
per-component repo is the registry's business.

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

## Looking up ancestor components

Every mounted component element exposes two ancestor-walking helpers,
stamped onto the element by `Component`'s constructor. They let a child
read context out of an enclosing component without any framework-level
prop drilling:

```ts
type Schema<T> = {
  init(): T;
  parse(value: unknown): T;
};

el.closestComponent<T>(schema: Schema<T>):    SchemaComponentRoot<T> | null;
el.ancestorComponent():                       ComponentRoot | null;
el.ancestorComponent<T>(schema: Schema<T>):   SchemaComponentRoot<T> | null;
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
