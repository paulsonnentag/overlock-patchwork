# Components

Declarative loading of ES modules out of the Automerge graph as live
DOM views. Each component package is a folder with a JSON manifest and
a JS module; pages embed it with `<patchwork-view src="automerge:...">`.
The registry watches the DOM, fetches the referenced sources, and
mounts the view — including hot reloads when the underlying Automerge
folder changes.

This builds on top of [the loader](./loader.md):
`importFromAutomerge(repo, url)` resolves an `automerge:` URL to an
executable ES module via blob URLs. The view system layers a
manifest format and a DOM lifecycle on top.

For doc binding (`<automerge-repo>`, `doc=`, `el.handle`) see
[`documents.md`](./documents.md). For mount/unmount semantics, HMR,
and race handling see [`lifecycle.md`](./lifecycle.md).

## Authoring a component package

A package is two files (plus a `.pushwork` folder once published):

```
packages/counter/
  counter.json
  counter.js
```

The names are conventions, not requirements — the loader takes any
path inside the folder doc and `manifest.importUrl` can point at any
sibling file. We name both files after the package because every
cross-package reference is an automerge URL of the form
`automerge:<rootDirectoryUrl>/<file>`, and `…/counter.json` is a lot
more useful than `…/component.json` when scanning a list of imports.

`counter.json`:

```json
{
  "name": "my-counter",
  "importUrl": "./counter.js"
}
```

`counter.js` — bundleless, imports are resolved by the loader's
specifier rewriter (so `https://esm.sh/...` URLs work as-is, and
relative paths walk the package's folder doc):

```js
import { createSignal } from "https://esm.sh/solid-js@1.9.5";
import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";

function Counter() {
  const [count, setCount] = createSignal(0);
  return html`
    <button type="button" onClick=${() => setCount(count() + 1)}>
      count: ${count}
    </button>
  `;
}

export default async function (element) {
  return render(() => Counter(), element);
}
```

The mount fn:

- runs in the browser with the live host `element` already in the DOM,
- can `await` anything (network, `repo.find`, dynamic imports) before
  touching the element,
- should return a function that tears down whatever it set up —
  listeners, intervals, framework dispose handles. The example above
  returns `render`'s dispose, which clears reactive owners and resets
  the element's `textContent`.

A view that doesn't need cleanup just returns nothing.

## Using a view on a page

`<patchwork-view>` is the only entry point:

```html
<script src="./dist/patchwork.js"></script>

<patchwork-view
  src="automerge:3F8HWx9Hm8JDDrSA1GZP9fRGSXi9/counter.json"
></patchwork-view>
```

`new ViewRegistry({ root, repo, pluginRegistry })` is the constructor
wired up in [`src/main.ts`](../src/main.ts); it owns the bootstrapped
`repo` and the `PluginRegistry` and only requires you to pick a root
element (almost always `document.body`).

## Composition: views inside views

Inside a view's JS, you can drop another `<patchwork-view>` and the
registry's observer will pick it up and bootstrap it the same way.
URLs are referenced directly — there's no attribute pass-through:

```js
const COUNTER_SRC = "automerge:4NdChAJ19xmag7Ae5sBnShBUq95i/counter.json";
const CLOCK_SRC = "automerge:2Xa2AQP4fg2MfuKc47pn7RmT6ZDB/clock.json";

function App() {
  return html`
    <h1>demo</h1>
    <patchwork-view src="${COUNTER_SRC}"></patchwork-view>
    <patchwork-view src="${CLOCK_SRC}"></patchwork-view>
  `;
}

export default async function (element) {
  return render(() => App(), element);
}
```

Each `<patchwork-view>` carries exactly one `src`, plus an optional
`doc` for binding to an Automerge document (see
[`documents.md`](./documents.md)). Multiple `<patchwork-view>` siblings
= multiple bootstrapped views.

## Contextual lookups

Every mounted view element carries three lookup methods that walk a
schema-indexed scope tree (`src/scope.ts`) which mirrors the *view*
tree — plain DOM (a wrapping `<div>`, a `<header>`, the
`<automerge-repo>` marker) is transparent. The methods all return a
`Handle` (`src/handle.ts`) — same shape as `DocHandle`: `value()` for
the current state, `on("change", fn)` for updates.

| method                  | walks                          | result                                         |
| ----------------------- | ------------------------------ | ---------------------------------------------- |
| `closestView(schema)`   | self → ancestors               | `Handle<SchemaViewElement<T> \| null>`         |
| `ancestorView()`        | parent → ancestors             | `Handle<ViewElement \| null>`                  |
| `ancestorView(schema)`  | parent → ancestors with parse  | `Handle<SchemaViewElement<T> \| null>`         |
| `childViews()`          | direct view-children           | `Handle<ViewElement[]>`                        |
| `childViews(schema)`    | direct view-children with parse| `Handle<SchemaViewElement<T>[]>`               |

`SchemaViewElement<T>` is `ViewElement<T>` with `handle` made
non-optional, so consumers can use the result as both an element
reference (e.g. `child.setAttribute("doc", url)`) and a typed
`DocHandle<T>` source (e.g. `makeDocumentProjection(account.handle)`).

Schemas are duck-typed (`{ parse(value): T; init?(): T }`) — pick any
validation library; the framework only ever calls `parse(handle.doc())`
and treats a thrown error as "no match." Schema registration is lazy
on first lookup and tree-wide.

```js
const accountSchema = {
  parse(value) {
    if (value?.["@patchwork"]?.type !== "account") {
      throw new Error("not an account doc");
    }
    return value;
  },
};

export default function (element) {
  const account$ = element.closestView(accountSchema);
  const apply = (account) => render(account, element);
  apply(account$.value());
  account$.on("change", apply);
  return () => account$.off("change", apply);
}
```

`childViews()` stops at the first view-element boundary in each branch
of the DOM, so a non-matching child does *not* shadow its grandchildren
— but those grandchildren also don't show up at the parent. Use
`closestView` from the leaves if you need cross-boundary visibility.

Views without a `doc=` still get a scope: they participate as
structural pass-throughs (descendants reach grandparents through them)
but never match any schema, so `closestView` skips them.

Sibling URLs are stable across re-pushes because each subpackage's
`.pushwork/` snapshot pins its own `rootDirectoryUrl`. Copy them out
of `packages/<name>/.pushwork/snapshot.json`.

## Design goals

Views are reusable in any context. A view must drop into any subtree
and behave sensibly without bespoke wiring. That means:

- **No required ad-hoc attributes.** `<patchwork-view>` carries only
  `src` and `doc`. Anything more — config, role, key, params — belongs
  in the doc the view is bound to. Resist the urge to grow
  `<patchwork-view>`'s attribute surface; that's an escape hatch out
  of the composition model, not a feature.
- **Optional context, gracefully handled.** Views that *use*
  ancestor context (`el.handle`, `el.repo`) must tolerate it being
  absent. Render a neutral placeholder, throw a clear error with a
  useful message, or no-op — but don't crash the page.
- **No globals as inputs.** A view reaches state through its element
  (`el.handle`, `el.repo`, attributes, children) — never through
  `window.*` or module-level singletons. That's what makes "stick
  this in any context" actually work; otherwise two parents on the
  same page can't host the same view independently.

The payoff is composability: any view can be a child, a sibling, a
root, or a leaf, with no wrapping ceremony. The framework's job is to
make context discoverable; the view's job is to deal with what it
finds.
