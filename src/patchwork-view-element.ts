import { AutomergeUrl } from "@automerge/automerge-repo/slim";

export const PATCHWORK_VIEW_TAG = "patchwork-view";

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
    // Pre-upgrade property writes (Solid clones from <template>, applies
    // bindings before connection) land as own-properties that shadow our
    // prototype setters once the upgrade fires. The web-components
    // "upgrade property" dance reassigns through the setter so the
    // reflected attribute actually appears.
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
