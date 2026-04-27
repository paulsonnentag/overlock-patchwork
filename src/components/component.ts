import { stampLookups } from "./ancestor-lookup";
import * as componentStore from "./component-store";
import type { ComponentRoot, MountFn } from "../types";

let nextId = 0;

/**
 * Lifecycle of a `Component`:
 *
 * - `idle` — constructed, `mount()` hasn't been called yet.
 * - `mounting` — `mount()` is awaiting the user's mount fn.
 * - `mounted` — mount fn resolved; cleanup (if any) is in `#teardowns`.
 * - `unmounted` — terminal. `unmount()` ran (or was called while the
 *   state was `mounting`, in which case the eventual mount-fn cleanup
 *   runs immediately and is discarded rather than installed).
 *
 * The enum is the single source of truth for "is the in-flight mount
 * still current?" and "has unmount run?" — `unmount()` flips it to
 * `unmounted`, and the post-await branches in `mount()` consult it
 * before installing any cleanup.
 */
export type ComponentState = "idle" | "mounting" | "mounted" | "unmounted";

/**
 * One mounted component. Owns:
 *
 * - The element it is mounted on.
 * - The mount fn — kept on the instance so the registry can rebuild
 *   the component (e.g. after a reactive `doc=` attribute change) without
 *   re-deriving it from the manifest.
 * - A `ComponentState` lifecycle. `unmount()` while `mounting` causes
 *   the in-flight mount fn's cleanup to run immediately on resolve
 *   rather than being installed.
 * - A teardown set. The user's returned cleanup is one entry; future
 *   framework-internal teardowns (per-instance listeners, etc.) push
 *   into the same set and run in insertion order on `unmount()`.
 *
 * No attribution / proxy machinery — components mutate their element as
 * plain DOM. Cleanup is the author's responsibility.
 */
export class Component {
  readonly id: number = ++nextId;
  el: HTMLElement;
  mountFn: MountFn;
  #state: ComponentState = "idle";
  readonly #teardowns = new Set<() => void>();

  constructor(el: HTMLElement, mountFn: MountFn) {
    this.el = el;
    this.mountFn = mountFn;
    // Register synchronously, *before* any await in the registry's
    // mount path runs. Otherwise the MutationObserver that fires for
    // the freshly-swapped element finds nothing in the store and
    // double-mounts via `#mountIfRegistered`.
    componentStore.register(el, this);
    // Stamp ancestor-lookup methods now (also synchronously) so a child
    // mount fn that runs while this component is still resolving its own
    // doc context can already walk up to find this element.
    stampLookups(el);
  }

  get state(): ComponentState {
    return this.#state;
  }

  async mount(): Promise<void> {
    if (this.#getState() !== "idle") return;
    this.#state = "mounting";

    let result: (() => void) | void;
    try {
      result = await this.mountFn(this.el as ComponentRoot);
    } catch (err) {
      console.error(
        `[overlock-patchwork] mount threw on <${this.el.localName}> #${this.id}:`,
        err,
      );
      // If unmount() ran while we were in flight, leave the terminal
      // state intact. Otherwise transition to `mounted` with no
      // installed teardown so a later unmount() is a clean no-op.
      if (this.#getState() === "mounting") this.#state = "mounted";
      return;
    }
    const cleanup = typeof result === "function" ? result : null;

    if (this.#getState() === "unmounted") {
      // Lost the race: unmount() ran while the user's mount fn was in
      // flight. Honor the cleanup contract by running it now and
      // discarding rather than installing it.
      runTeardown(cleanup);
      return;
    }
    if (cleanup) this.#teardowns.add(cleanup);
    this.#state = "mounted";
  }

  // Wrapper that hides the narrowing TypeScript would otherwise apply
  // to `#state` across `await` and assignment boundaries. Direct reads
  // inside `mount()` look "always 'idle'" or "always 'mounting'" to the
  // checker after a comparison or assignment, even though `unmount()`
  // can mutate concurrently between the two ticks.
  #getState(): ComponentState {
    return this.#state;
  }

  /**
   * Register a framework-internal teardown to run on the next
   * `unmount()`. Mirrors the user's mount-fn cleanup contract: callers
   * pass a sync function that reverses whatever they set up. Idempotent
   * with respect to the same function reference.
   *
   * No-op if the component has already been unmounted (the teardown's
   * scope is presumed to have already been torn down with it).
   */
  addTeardown(fn: () => void): void {
    if (this.#state === "unmounted") return;
    this.#teardowns.add(fn);
  }

  unmount(): void {
    if (this.#state === "unmounted") return;
    this.#state = "unmounted";
    const teardowns = Array.from(this.#teardowns);
    this.#teardowns.clear();
    for (const fn of teardowns) runTeardown(fn);
    componentStore.unregister(this.el);
  }
}

function runTeardown(fn: (() => void) | null): void {
  if (!fn) return;
  try {
    fn();
  } catch (err) {
    console.error("[overlock-patchwork] teardown threw", err);
  }
}
