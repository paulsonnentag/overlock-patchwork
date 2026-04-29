export const PATCHWORK_CONTEXT_TAG = "patchwork-context";

/**
 * Autonomous custom element for `<patchwork-context>`. A subscribable
 * value carrier for descendant views: a parent assigns
 * `el.source = …`, and any descendant walks up via
 * `el.closest("patchwork-context")` to read the current value or
 * subscribe to changes.
 *
 * The element *is* the subscribable. It extends `EventTarget` (every
 * `HTMLElement` does) and exposes `value` as a getter. Consumers wire
 * up the standard DOM idiom:
 *
 *   const ctx = el.closest("patchwork-context");
 *   if (!ctx) return;
 *   const handler = e => doSomething(e.target.value);
 *   ctx.addEventListener("change", handler);
 *   return () => ctx.removeEventListener("change", handler);
 *
 * `addEventListener` accepts `{ signal }` for batch cleanup against
 * an `AbortController`.
 *
 * `source` accepts two shapes:
 *
 * 1. A plain object — the element copies it into `value` and emits
 *    `change` once. Subsequent reassignments to a different object
 *    fire another `change`.
 * 2. An upstream `EventTarget` (e.g. another `<patchwork-context>`,
 *    a `Handle`, anything that fires `change` and exposes `.value`).
 *    The element subscribes to the upstream `change` events and
 *    re-emits its own `change` whenever the upstream value flips.
 *    Consumers don't need to know the difference; they always read
 *    `el.value`.
 *
 * The unwrapped input is also readable as `el.source` so callers can
 * recover the original (e.g. when forwarding a `DocHandle`'s extra
 * surface like `.url` or `.change(fn)`).
 *
 * Defined once at module load. Like `<patchwork-view>`, this is
 * *not* a view — `mountView` never runs on it; it has its own
 * custom-element lifecycle.
 */
export class PatchworkContext extends HTMLElement {
  #source: unknown = null;
  #value: unknown = null;
  #unsubscribe: (() => void) | null = null;

  get source(): unknown {
    return this.#source;
  }

  set source(input: unknown) {
    if (input === this.#source) return;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#source = input;
    if (isSubscribable(input)) {
      const handler = (): void => this.#setValue(input.value);
      input.addEventListener("change", handler);
      this.#unsubscribe = () =>
        input.removeEventListener("change", handler);
      this.#setValue(input.value);
    } else {
      this.#setValue(input);
    }
  }

  get value(): unknown {
    return this.#value;
  }

  connectedCallback(): void {
    // Same upgrade dance as <patchwork-view>: a property assigned
    // before the element was upgraded lands as an own data property
    // that shadows the prototype accessor. Read it off, delete the
    // own slot, re-assign so the setter runs.
    this.#upgradeProperty("source");
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #setValue(next: unknown): void {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    this.dispatchEvent(new Event("change"));
  }

  #upgradeProperty(name: "source"): void {
    if (!Object.prototype.hasOwnProperty.call(this, name)) return;
    const value = (this as unknown as Record<string, unknown>)[name];
    delete (this as unknown as Record<string, unknown>)[name];
    (this as unknown as Record<string, unknown>)[name] = value;
  }
}

type Subscribable = EventTarget & { value: unknown };

function isSubscribable(input: unknown): input is Subscribable {
  return input instanceof EventTarget && "value" in (input as object);
}

if (!customElements.get(PATCHWORK_CONTEXT_TAG)) {
  customElements.define(PATCHWORK_CONTEXT_TAG, PatchworkContext);
}
