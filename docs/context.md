# Context

A *context* is any custom-element ancestor that publishes a value
descendants can read. There's no special tag — the runtime walks up
ancestors looking for a custom element (tag name with a hyphen)
exposing a `value` property; the consumer's predicate filters
further. The dash check rules out built-in form elements (`<input>`,
`<select>`, `<button>`, …) whose native `.value` would otherwise be
picked up by the duck-type test.

Source: walk in [`src/view.ts`](../src/view.ts) (`walkContexts`).
Helper: [`packages/context/context.js`](../packages/context/context.js).

## Provider

A context view is a regular view authored with `defineContext`:

```js
import { defineContext } from "automerge:.../context.js";

export default defineContext((element) => {
  element.source = element.handle;
});
```

`defineContext` wraps the user mount fn. Before calling it, the
wrapper installs `value` (read-only getter) and `source` (setter) on
the host element, plus the `change`-event machinery. The mount fn
keeps the standard contract — same signature, sync or async, returns
a cleanup or void.

`source` accepts two shapes:

1. **Plain value** — copied to `value`, dispatches `change` once
   per new reference (deduped by `Object.is`).
2. **Upstream subscribable** — anything that's an `EventTarget` with
   a `value` property (a `Handle<T>` from
   [`src/handle.ts`](../src/handle.ts), another `defineContext`-wrapped
   ancestor, …). The wrapper subscribes, mirrors `value`,
   re-dispatches `change`, and unsubscribes on cleanup. A `DocHandle`
   is *not* subscribable in this sense (no `.value`) — pass it
   directly and let descendants read `.doc()` off the published value.

`element.source` keeps the original input around for callers that
need the upstream's extra surface.

## Consumer

Inside any mount fn, walk up via `el.context`:

```js
const account = element.context(
  v => typeof v?.doc === "function" && v.doc()?.["@patchwork"]?.type === "account",
);
```

`el.context(predicate)` returns the `value` of the innermost
context whose value satisfies `predicate`, or `null` if no match is
in scope. Snapshot lookup — for reactive reads subscribe to the
matched element's `change` event, or wrap a returned `DocHandle`
with `makeDocumentProjection`.

Top-down mounting (see [`lifecycle.md`](./lifecycle.md)) guarantees
ancestor contexts have finished mounting — and therefore installed
their `value` getter — when the descendant mount fn runs, so
`el.context` always sees a populated ancestor stack.

For consumers that need to subscribe to a single known context (not
walk past unrelated ones), use the standard DOM idiom directly:

```js
const ctx = element.closest("account-context");
if (!ctx) return;
const controller = new AbortController();
ctx.addEventListener("change", e => render(e.target.value), {
  signal: controller.signal,
});
return () => controller.abort();
```

## Stacked contexts

Multiple context views compose by carrying different value shapes —
an account doc handle here, a folder doc handle one level deeper,
the page-level `BranchableRepo` at the top. `el.context(predicate)`
walks past any context whose value doesn't match. `el.repo` is
stamped this way against `v instanceof BranchableRepo`.

## Bootstrap

`src/main.ts` wraps `<body>` in a hyphenated custom-tag wrapper
(`<patchwork-root>`) with `value` set to the page-level
`BranchableRepo`. No `defineContext` is used at the bootstrap
boundary — the wrapper installs only `value` (no `source` setter,
no `change` dispatch) because the page-level repo never changes
after install. Any closer context that publishes a different repo
overrides it via the walk.

## When to reach for it

Use it for shared subtree state (account, branch handle, selection)
where the value isn't a single document URL — for that case, just
set `doc=` on the children directly.
