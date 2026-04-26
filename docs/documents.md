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
