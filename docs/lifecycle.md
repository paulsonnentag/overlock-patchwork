# Lifecycle

Mount/unmount sequence, hot module reload, and race handling for the
component registry. Reads the source it documents:
[`src/components/component-registry.ts`](../src/components/component-registry.ts)
and [`src/components/component.ts`](../src/components/component.ts).

## Mount sequence

```mermaid
sequenceDiagram
  participant DOM
  participant MO as MutationObserver
  participant Reg as ComponentRegistry
  participant MC as mountComponent
  participant Repo as Automerge Repo
  participant Mod as component.js

  DOM->>MO: <patchwork-view src=X doc=Y?> inserted
  MO->>Reg: #handleElement(el)
  Reg->>Reg: #ensureLoaded(X) (dedupes parallel calls)
  Reg->>Repo: find folder + manifest doc
  Repo-->>Reg: { name, url }
  Reg->>Repo: pinSpec(url) -> AutomergeUrl with current heads
  Reg->>Mod: automergeImport(pinned) -> default export
  Mod-->>Reg: mountFn
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

When `<name>` is later removed from the DOM, the observer fires for
the removal and the registry calls `unmountElement(el)`, which runs
the installed cleanup and forgets the element.

## Hot module reload

The registry subscribes to the manifest's *parent folder* document on
load. Pushwork propagates child writes upward, so any change inside
the component's package — manifest, JS, anything — fires a `change`
event on the parent folder handle.

On change, the registry:

1. Re-fetches the manifest and re-imports the JS (with a heads-pinned
   spec so `automergeImport`'s blob cache produces a fresh module).
2. No-ops if both `manifest.name` and the `mountFn` reference are
   unchanged (defends against spurious change events).
3. If `manifest.name` changed, drops the old name from the registry
   and throws if the new name collides with an existing entry.
4. For every element currently mounted under the previous tag name
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
