import { stampLookups } from "./ancestor-lookup.js";
import * as componentStore from "./component-store.js";
import { log } from "./log.js";
import type { ComponentRoot, MountFn } from "./types.js";

let nextId = 0;

/**
 * One mounted component. Owns:
 *
 * - The element it is mounted on.
 * - The mount fn — kept on the instance so the registry can rebuild
 *   the component (e.g. after a reactive `doc=` attribute change) without
 *   re-deriving it from the manifest.
 * - A generation counter that lets `unmount()` invalidate any in-flight
 *   `mount()` so the cleanup it eventually returns is run immediately and
 *   discarded rather than installed.
 * - The cleanup fn returned from the user's mount (once it resolves and is
 *   still current).
 *
 * No attribution / proxy machinery — components mutate their element as
 * plain DOM. Cleanup is the author's responsibility.
 */
export class Component {
  readonly id: number = ++nextId;
  el: HTMLElement;
  mountFn: MountFn;
  #generation = 0;
  #cleanup: (() => void) | null = null;
  #unmounted = false;

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

  async mount(): Promise<void> {
    const gen = ++this.#generation;

    log(`mount: <${this.el.localName}> #${this.id} gen=${gen} → user mountFn`);

    let result: (() => void) | void;
    try {
      result = await this.mountFn(this.el as ComponentRoot);
    } catch (err) {
      console.error(
        `[overlock-patchwork] mount threw on <${this.el.localName}> #${this.id}:`,
        err,
      );
      return;
    }
    const cleanup = typeof result === "function" ? result : null;

    // Lost the race: this Component was unmounted (or remounted under a new
    // generation by HMR) while the async mount fn was in flight. Honor the
    // cleanup contract by running it immediately and discarding.
    if (this.#unmounted || gen !== this.#generation) {
      log(
        `mount: <${this.el.localName}> #${this.id} gen=${gen} lost race (unmounted=${this.#unmounted}, gen-now=${this.#generation}); running cleanup eagerly`,
      );
      runCleanup(cleanup);
      return;
    }
    log(
      `mount: <${this.el.localName}> #${this.id} gen=${gen} done (cleanup=${cleanup ? "yes" : "none"})`,
    );
    this.#cleanup = cleanup;
  }

  unmount(): void {
    if (this.#unmounted) return;
    this.#unmounted = true;
    this.#generation++;
    const cleanup = this.#cleanup;
    this.#cleanup = null;
    log(
      `unmount: <${this.el.localName}> #${this.id} (cleanup=${cleanup ? "yes" : "none"})`,
    );
    runCleanup(cleanup);
    componentStore.unregister(this.el);
  }
}

function runCleanup(cleanup: (() => void) | null): void {
  if (!cleanup) return;
  try {
    cleanup();
  } catch (err) {
    console.error("[overlock-patchwork] cleanup threw", err);
  }
}
