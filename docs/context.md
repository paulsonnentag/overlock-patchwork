# Context

`<patchwork-context>` carries a value down the DOM for any descendant
view to read. Built-in autonomous custom element, registered as a
side-effect import from
[`src/main.ts`](../src/main.ts).

Source:
[`src/patchwork-context-element.ts`](../src/patchwork-context-element.ts).

## Provider

Set the JS *property* `source` (not an attribute — value is an
object):

```js
<patchwork-context source=${account}>
  <patchwork-view src=${WELCOME_SRC}></patchwork-view>
</patchwork-context>
```

`source` accepts two shapes:

1. **Plain object** — copied to `value`, dispatches `change` once
   per new reference (deduped by `Object.is`).
2. **Upstream subscribable** — anything that's an `EventTarget` with
   a `value` property (another `<patchwork-context>`, a `Handle<T>`
   from [`src/handle.ts`](../src/handle.ts), a `DocHandle`, …). The
   element subscribes, mirrors `value`, re-dispatches `change`.

`el.source` keeps the original input around for callers that need
the upstream's extra surface. Property writes that land before
upgrade (Solid `<template>` clone path) flow through the setter on
`connectedCallback`. Subscriptions are dropped in
`disconnectedCallback`.

## Consumer

Inside a mount fn, walk up stacked contexts via `el.context`
(stamped onto every `ViewElement` — see [`src/view.ts`](../src/view.ts)):

```js
const account = element.context(
  v => typeof v?.doc === "function" && v.doc()?.["@patchwork"]?.type === "account",
);
```

`el.context(predicate)` returns the `value` of the innermost
`<patchwork-context>` whose value satisfies `predicate`, or `null`
if no match is in scope. Snapshot lookup — for reactive reads
subscribe to the matched context's `change` event, or wrap a
returned doc handle with `makeDocumentProjection`.

Top-down mounting (see [`lifecycle.md`](./lifecycle.md)) guarantees
ancestor wrappings are already in place when the descendant mount
fn runs, so `el.context` always sees the final ancestor stack.

For consumers that need to subscribe to a single known context (not
walk past unrelated ones), use the standard DOM idiom directly:

```js
const ctx = element.closest("patchwork-context");
if (!ctx) return;
const controller = new AbortController();
ctx.addEventListener("change", e => render(e.target.value), {
  signal: controller.signal,
});
return () => controller.abort();
```

## Stacked contexts

Multiple `<patchwork-context>` ancestors compose by carrying
different value shapes — an account doc handle here, a folder doc
handle one level deeper, the page-level `BranchableRepo` at the
top. `el.context(predicate)` walks past any context whose value
doesn't match. `el.repo` is stamped this way against
`v instanceof BranchableRepo`.

## When to reach for it

Use it for shared subtree state (account, branch handle, selection)
where the value isn't a single document URL — for that case, just
set `doc=` on the children directly.
