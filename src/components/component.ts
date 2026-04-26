import * as componentStore from "./component-store.js";
import type { MountFn } from "./types.js";

/**
 * One mounted component. Owns:
 *
 * - The element it is mounted on.
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
  el: HTMLElement;
  #generation = 0;
  #cleanup: (() => void) | null = null;
  #unmounted = false;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  async mount(mountFn: MountFn): Promise<void> {
    componentStore.register(this.el, this);
    const gen = ++this.#generation;

    let result: (() => void) | void;
    try {
      result = await mountFn(this.el);
    } catch (err) {
      console.error("[overlock-patchwork] mount threw", err);
      return;
    }
    const cleanup = typeof result === "function" ? result : null;

    // Lost the race: this Component was unmounted (or remounted under a new
    // generation by HMR) while the async mount fn was in flight. Honor the
    // cleanup contract by running it immediately and discarding.
    if (this.#unmounted || gen !== this.#generation) {
      runCleanup(cleanup);
      return;
    }
    this.#cleanup = cleanup;
  }

  unmount(): void {
    if (this.#unmounted) return;
    this.#unmounted = true;
    this.#generation++;
    const cleanup = this.#cleanup;
    this.#cleanup = null;
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
