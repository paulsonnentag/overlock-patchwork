# Lifecycle

Mount/unmount sequence, HMR, and race handling. Documents the source
in [`src/view-registry.ts`](../src/view-registry.ts),
[`src/plugin-registry.ts`](../src/plugin-registry.ts), and
[`src/view.ts`](../src/view.ts).

## Top-down mounting

The DOM walk stops at view boundaries — `<patchwork-view>`s waiting to
bootstrap, or any element already claimed by `mountView`.
`walkStoppingAtViews` (`view-registry.ts`) is used by the initial
scan, every `addedNodes` MO record, and the post-mount cascade.

Inside `mountView`, each new view awaits its closest ancestor view's
`mounted` promise before resolving `doc=` or running the user mount
fn. Two consequences:

- Ancestor mount fns see their template children unmodified — they
  can imperatively set `doc=`, wrap in `<patchwork-context>`,
  reorder, etc., and the children's mount fns observe the final
  state.
- Descendants always observe a fully-settled ancestor.

After a mount fn returns successfully, the registry cascades into
the now-static children using the same stop-at-view walk.

If `resolveContext` or the mount fn throws, the `mounted` promise
rejects, descendants awaiting it bail, and the cascade does nothing.
Subtree stays empty rather than partially populated.

## Mount sequence

When `<patchwork-view src=X doc=Y?>` is inserted, the
`MutationObserver` calls `#handleElement` (which stops descending at
that boundary). The view registry calls `pluginRegistry.load(X)`,
which dedupes parallel calls, finds the folder + manifest, resolves
`importUrl` + pins to current heads, runs the loader for the module,
and on first load subscribes to the parent folder for HMR. The
returned `LoadedPlugin` lets the view registry extract a mount fn,
register the tag, and `swapTag` the `<patchwork-view>` to the user's
tag (copying only `doc=`).

`mountView(newEl, mountFn)` then claims `newEl` synchronously, stamps
`newEl.repo = window.repo`, awaits the closest ancestor view's
`mounted`, calls `resolveContext(newEl)` to read `doc=` and
`repo.find(Y)`, stamps `newEl.handle`, runs the user mount fn, and
installs the returned cleanup in the views map. The view registry's
post-mount cascade then walks `newEl`'s children with the same
stop-at-view rule.

When the element is later removed, `unmountView(el)` runs the
installed cleanup and forgets the element.

## Hot module reload

The plugin registry subscribes to the manifest's *parent folder* on
first load. Pushwork bubbles writes upward, so any change inside the
package fires `change`.

On change, the **plugin registry** re-fetches the manifest and
re-imports the JS (heads-pinned URL → loader produces a fresh
module), splices the new `LoadedPlugin` into its cache, and
dispatches `updated` + `changed`.

The **view registry**'s `#onPluginUpdate` handler:

1. No-op if `name` and `module` reference are both unchanged.
2. Bails if the previous load wasn't view-shaped.
3. Extracts a fresh mount fn. If extraction fails, tears down every
   instance under the previous tag and removes those elements.
4. If `name` changed, drops the old name and throws on collisions.
5. For every element under the previous tag: `unmountView`, create
   fresh element under new tag (carrying attrs + children), insert
   in place, `mountView` against the new element. Top-down barrier
   still applies.

Element identity is intentionally lost on reload — "teardown +
remount", not "patch in place" — so the cleanup contract stays
honest.

## Race handling

`mountView` is async. Three things can race it:

1. Element removed before the mount fn resolves.
2. View hot-reloaded before the mount fn resolves.
3. `doc=` attribute changes before the mount fn resolves.

(2) and (3) both go through `#rebuildInstance` (detach + remount).
The element is the identity carrier; there is no separate `View`
instance to signal. `mountView` reads `el.isConnected` after every
`await`; a detached element short-circuits, and a returned cleanup
is run-and-discarded rather than installed.

The mount pipeline claims `el` and stamps `el.repo` synchronously,
then awaits the closest ancestor's `mounted`. If that rejects (an
ancestor failed) or `el` disconnected meanwhile, the claim is dropped
and the function returns. It then awaits `resolveContext(el)`; on
disconnect it drops the claim, on throw it re-throws so descendants
observe the failure. Finally it awaits the user mount fn; on
disconnect it runs-and-discards the returned cleanup, on throw it
re-throws. Only after all three awaits succeed does it install the
cleanup in the views map.

`doc=` rebuilds are microtask-batched: synchronous writes in the
same tick coalesce into a single rebuild that reads the final
attribute value.
