# Components

A *component package* is a folder doc with two files: a JSON manifest
and a JS module. Pages embed it with `<patchwork-view src="automerge:...">`.
The view registry watches the DOM, fetches the package via the
[loader](./loader.md), and mounts the module's default export.

For doc binding (`doc=`, `el.handle`) see
[`documents.md`](./documents.md). For provider/consumer values see
[`context.md`](./context.md). For mount/unmount semantics, HMR, and
race handling see [`lifecycle.md`](./lifecycle.md).

## Package layout

```
packages/counter/
  counter.json   # { "name": "my-counter", "importUrl": "./counter.js" }
  counter.js     # default export = mount fn
```

Filenames are convention only — any sibling path inside the folder
works. `name` must contain a hyphen (HTML custom-element rule).
`importUrl` must start with `./`.

## Mount fn

Default export, async, gets the host element:

```js
export default async function (element) {
  // build content / wrap children / set attrs
  return () => { /* cleanup */ };
}
```

The element is already in the DOM. `element.repo` is set; if `doc=`
was on `<patchwork-view>`, `element.handle` is too. Return a cleanup
fn or nothing. Imports inside the module are rewritten by the loader,
so `https://esm.sh/...` and relative paths both work.

## Embedding

```html
<script src="./dist/patchwork.js"></script>

<patchwork-view src="automerge:.../counter.json"></patchwork-view>
```

Inside another view's JS you can drop more `<patchwork-view>`s — the
registry's observer picks them up. Each carries one `src` plus an
optional `doc` (see [`documents.md`](./documents.md)). Attributes
other than `doc=` are dropped on the swap to the user's tag.

## Design rules

- **No ad-hoc attributes on `<patchwork-view>`.** Configure views via
  the document they're bound to, not new attributes.
- **`el.handle` is optional, `el.repo` is always present.** Views
  must tolerate `el.handle` being `undefined`.
- **No globals as inputs.** Read state through `el.handle`,
  `el.repo`, attributes, or children — not `window.*`.

The view registry is wired up in [`src/main.ts`](../src/main.ts).
