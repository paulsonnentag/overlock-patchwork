# Components

Declarative loading of ES modules out of the Automerge graph as live
DOM components. Each component is a folder with a JSON manifest and a
JS module; pages embed them with `<patchwork-view src="automerge:...">`.
The registry watches the DOM, fetches the referenced sources, and
mounts them — including hot reloads when the underlying Automerge
folder changes.

This builds on top of [the loader](./loader.md): `automergeImport(spec)`
resolves an `automerge:` URL to an executable ES module via blob URLs.
The component system layers a manifest format and a DOM lifecycle on
top.

For doc binding (`<automerge-repo>`, `doc=`, `el.handle`) see
[`documents.md`](./documents.md). For mount/unmount semantics, HMR,
and race handling see [`lifecycle.md`](./lifecycle.md).

## Authoring a component

A package is two files (plus a `.pushwork` folder once published):

```
packages/counter/
  component.json
  component.js
```

`component.json`:

```json
{
  "name": "my-counter",
  "url": "./component.js"
}
```

`component.js` — bundleless, imports are resolved by `automergeImport`'s
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

A component that doesn't need cleanup just returns nothing.

## Using a component on a page

`<patchwork-view>` is the only entry point:

```html
<script src="./dist/overlock.js"></script>

<patchwork-view
  src="automerge:3F8HWx9Hm8JDDrSA1GZP9fRGSXi9/component.json"
></patchwork-view>

<script type="module">
  await window.isPatchworkReady;
  window.createComponentRegistry(document.body);
</script>
```

`createComponentRegistry(root)` is the factory exposed by
[`src/main.ts`](../src/main.ts); it closes over the bootstrapped `repo`
and `automergeImport` and only requires you to pick a root element
(almost always `document.body`).

## Composition: components inside components

Inside a component's JS, you can drop another `<patchwork-view>` and
the registry's observer will pick it up and bootstrap it the same way.
URLs are referenced directly — there's no attribute pass-through:

```js
const COUNTER_SRC = "automerge:4NdChAJ19xmag7Ae5sBnShBUq95i/component.json";
const CLOCK_SRC = "automerge:2Xa2AQP4fg2MfuKc47pn7RmT6ZDB/component.json";

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
= multiple bootstrapped components.

Sibling URLs are stable across re-pushes because each subpackage's
`.pushwork/` snapshot pins its own `rootDirectoryUrl`. Copy them out
of `packages/<name>/.pushwork/snapshot.json`.
