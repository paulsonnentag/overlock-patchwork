import { AutomergeUrl } from "@automerge/automerge-repo/slim";

export const PATCHWORK_VIEW_TAG = "patchwork-view";

/**
 * Autonomous custom element for `<patchwork-view>`. The only thing it adds
 * over a plain `HTMLElement` is `src` and `doc` accessors that reflect to
 * the matching attribute, so frameworks that property-assign on hyphenated
 * tags (Solid's `html` template, Lit, etc.) end up writing through
 * `setAttribute`. The `ViewRegistry`'s MutationObserver-based bootstrap
 * then reads the attributes as usual.
 *
 * Defined once at module load. Registry orchestration for actual views
 * (`my-counter`, `wall-clock`, ...) does NOT go through `customElements` —
 * those stay plain `document.createElement(name)` elements so HMR can
 * rebuild them freely without hitting the global one-shot ratchet.
 */
export class PatchworkView extends HTMLElement {
  #src: string | null = null;
  #doc: AutomergeUrl | null = null;

  get src(): string | null {
    return this.#src;
  }

  set src(value: string | null) {
    if (this.#src === value) return;
    this.#src = value;
    const attr = this.getAttribute("src");
    if (attr == value) return;
    if (value) {
      this.setAttribute("src", value);
    } else {
      this.removeAttribute("src");
    }
  }

  get doc(): AutomergeUrl | null {
    return this.#doc;
  }

  set doc(value: AutomergeUrl | null) {
    if (this.#doc === value) return;
    this.#doc = value;
    const attr = this.getAttribute("doc");
    if (attr == value) return;
    if (value) {
      this.setAttribute("doc", value);
    } else {
      this.removeAttribute("doc");
    }
  }

  static get observedAttributes() {
    return ["src", "doc"];
  }

  connectedCallback() {
    // Solid's `html` template clones from a <template> whose contents
    // live in an inert document; nested custom elements there don't get
    // upgraded until they're moved into the live tree. lit-dom-expressions
    // applies attribute bindings as property writes (`el.src = X`) on those
    // not-yet-upgraded clones, which lands as a plain own-property on the
    // HTMLElement. Once the element is connected and the upgrade fires,
    // that own-property shadows our prototype `set src` forever — every
    // later assignment (including `this.src = ...` below) silently bypasses
    // the setter and the reflected attribute never appears, so the
    // ViewRegistry's MutationObserver never sees a `<patchwork-view src=…>`
    // worth bootstrapping. The "upgrade property" dance from the web
    // components spec recovers the pre-upgrade value: read it off, delete
    // the own slot (un-shadowing the prototype accessor), then re-assign
    // so the setter runs and reflects to the attribute.
    this.#upgradeProperty("src");
    this.#upgradeProperty("doc");
  }

  attributeChangedCallback(
    name: string,
    old: string | null,
    value: string | null,
  ) {
    if (old === value) return;
    if (name === "src") {
      this.#src = value;
    }
    if (name === "doc") {
      this.#doc = value as AutomergeUrl | null;
    }
  }

  #upgradeProperty(name: "src" | "doc"): void {
    if (!Object.prototype.hasOwnProperty.call(this, name)) return;
    const value = (this as unknown as Record<string, unknown>)[name];
    delete (this as unknown as Record<string, unknown>)[name];
    (this as unknown as Record<string, unknown>)[name] = value;
  }
}

if (!customElements.get(PATCHWORK_VIEW_TAG)) {
  customElements.define(PATCHWORK_VIEW_TAG, PatchworkView);
}
