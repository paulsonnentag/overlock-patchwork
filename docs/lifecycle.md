# Lifecycle

Mount/unmount sequence, hot module reload, and race handling for the
component registry. Reads the source it documents:
[`src/components/component-registry.ts`](../src/components/component-registry.ts),
[`src/components/plugin-registry.ts`](../src/components/plugin-registry.ts),
and [`src/components/component.ts`](../src/components/component.ts).

## Mount sequence

```mermaid
sequenceDiagram
  participant DOM
  participant MO as MutationObserver
  participant Reg as ComponentRegistry
  participant Plug as PluginRegistry
  participant MC as mountComponent
  participant Repo as Automerge Repo
  participant Mod as component.js

  DOM->>MO: <patchwork-view src=X doc=Y?> inserted
  MO->>Reg: #handleElement(el)
  Reg->>Plug: load(X) (dedupes parallel calls)
  Plug->>Repo: find folder + manifest doc
  Repo-->>Plug: { name, importUrl, ... }
  Plug->>Plug: resolve importUrl to absolute URL
  Plug->>Repo: pinPluginUrl(absolute) -> AutomergeUrl with current heads
  Plug->>Mod: automergeImport(pinned) -> module
  Mod-->>Plug: module
  Plug->>Plug: subscribe parent folder for HMR (first load only)
  Plug-->>Reg: LoadedPlugin { name, importUrl, module, ... }
  Plug->>Plug: emit "loaded" + "changed"
  Reg->>Reg: extract mount fn from module.default
  Reg->>Reg: #registerComponent(name, mountFn) (collision -> throw)
  Reg->>DOM: swapTag <patchwork-view> -> <name>
  Reg->>MC: mountComponent(newEl, mountFn)
  MC->>MC: claim newEl in cleanups map (sync)
  MC->>MC: stamp newEl.repo from closest <automerge-repo> (sync)
  MC->>MC: resolveContext(newEl) — read doc=, find <automerge-repo>
  MC->>Repo: repo.find(Y) (only if doc= set)
  Repo-->>MC: DocHandle
  MC->>DOM: stamp newEl.handle = DocHandle
  MC->>Mod: mountFn(newEl)
  Mod->>DOM: build content (reads element.handle / element.repo if needed)
  Mod-->>MC: cleanup fn
  MC->>MC: install cleanup in cleanups map
```

The component registry installs a single `pluginRegistry.on("updated", ...)`
listener in its constructor so subsequent folder changes flow back
to `#onPluginUpdate` (see below). The listener reference is held in
`#onPluginUpdated` and detached via `pluginRegistry.off(...)` in
`destroy()`. One global listener fans out updates for every plugin
URL — there's no per-URL subscription.

When `<name>` is later removed from the DOM, the observer fires for
the removal and the registry calls `unmountElement(el)`, which runs
the installed cleanup and forgets the element.

## Hot module reload

The plugin registry subscribes to the manifest's *parent folder*
document on first load. Pushwork propagates child writes upward, so
any change inside the component's package — manifest, JS, anything —
fires a `change` event on the parent folder handle.

On change, the **plugin registry**:

1. Re-fetches the manifest and re-imports the JS (with a heads-pinned
   URL so `automergeImport`'s blob cache produces a fresh module).
2. Splices the fresh `LoadedPlugin` into its cached record.
3. Emits `updated(pluginUrl, previous, next)` and `changed()`.

The **component registry**'s `#onPluginUpdate` handler then:

1. No-ops if both `name` and the `module` reference are unchanged
   (defends against spurious change events; the plugin registry
   doesn't pre-dedup).
2. Bails if the previous load wasn't component-shaped — there's
   nothing in the name table to update.
3. Tries to extract a fresh mount fn from `next.module.default`.
   If extraction fails (the new module isn't component-shaped),
   tears down every existing instance under the previous tag name
   and removes those elements from the DOM. Otherwise:
4. If `name` changed, drops the old name from the name table and
   throws if the new name collides with an existing entry.
5. Sets the new name → mountFn entry.
6. For every element currently mounted under the previous tag name
   (found by walking the registry's root looking for the tag, filtered
   by `isComponent`): tears it down via `unmountElement` (runs the
   installed cleanup), creates a fresh element under the new tag name
   (carrying the current attrs and children), inserts it in place, and
   calls `mountComponent` against the new element.

Element identity is intentionally lost on reload — the chosen
semantics is "teardown + remount", not "patch in place". That keeps
the cleanup contract honest: every reload runs the previous cleanup
before the new mount fn touches anything.

## Race handling

`mountComponent` is async. Three things can race it:

1. The element is removed from the DOM before the mount fn resolves.
2. The component is hot-reloaded before the mount fn resolves.
3. The `doc=` attribute changes before the mount fn resolves.

Cases 2 and 3 both go through `#rebuildInstance`, which detaches the
old element (running `unmountElement` on it first) and creates a fresh
one. The element is the identity carrier for a mounted component;
there is no separate `Component` instance to signal. The race
guarantee falls out of two facts:

- `mountComponent` reads `el.isConnected` after every `await`. A
  detached element short-circuits the post-await branch.
- The user's returned cleanup is run-and-discarded (rather than
  installed) when the post-`await mountFn` `isConnected` check is
  false.

Concretely, `mountComponent` looks like:

```
claim el in cleanups map         (sync)
stamp el.repo                    (sync)
await resolveContext(el)
  if el disconnected → drop claim, return
await mountFn(el)
  if el disconnected → run-and-discard cleanup, drop claim, return
install cleanup in cleanups map
```

The `cleanups` map (in `component.ts`) is the only persistent
per-component state in the system. There is no four-state enum, no
teardown set, no `Component.unmount()` method — just an element
that has or hasn't been claimed, and (after a successful mount) an
optional cleanup keyed by that element.

`doc=` rebuilds are **microtask-batched**: a series of synchronous
writes in the same tick (e.g. a context-provider walking through
several intermediate URLs in one Solid effect) coalesce into a single
rebuild that reads the final attribute value. Without batching, the
descendant would tear down and re-mount once per write.

That preserves the "for every successful mount, exactly one cleanup
runs" invariant even when the user's mount fn is doing something
slow.
