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
    this.src = this.getAttribute("src");
    this.doc = this.getAttribute("doc") as AutomergeUrl | null;
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
}

if (!customElements.get(PATCHWORK_VIEW_TAG)) {
  customElements.define(PATCHWORK_VIEW_TAG, PatchworkView);
}
