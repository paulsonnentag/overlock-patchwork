export const PATCHWORK_VIEW_TAG = "patchwork-view";
export const SRC_ATTR = "src";
export const DOC_ATTR = "doc";

/**
 * Autonomous custom element for `<patchwork-view>`. The only thing it adds
 * over a plain `HTMLElement` is `src` and `doc` accessors that reflect to
 * the attribute, so frameworks that property-assign on hyphenated tags
 * (Solid's `html` template, Lit, etc.) end up writing through
 * `setAttribute`. The `ComponentRegistry`'s MutationObserver-based
 * bootstrap then reads the attributes as usual.
 *
 * The constructor runs the standard "lazy property upgrade" dance for
 * `src` and `doc`: when an element is cloned out of a `<template>` (Solid
 * does this), the dynamic attribute writes happen *before* the prototype
 * has been swapped to `PatchworkView`, so they land as own data
 * properties on the element. After upgrade those own properties shadow
 * the prototype accessors and the setter never reflects to the attribute.
 * Reading + deleting + re-assigning here forces the value back through
 * our setter so the attribute shows up.
 *
 * Defined once at module load. Registry orchestration for actual components
 * (`my-counter`, `wall-clock`, ...) does NOT go through `customElements` —
 * those stay plain `document.createElement(name)` elements so HMR can
 * rebuild them freely without hitting the global one-shot ratchet.
 */
export class PatchworkView extends HTMLElement {
  constructor() {
    super();
    upgradeProperty(this, "src");
    upgradeProperty(this, "doc");
  }

  get src(): string {
    return this.getAttribute(SRC_ATTR) ?? "";
  }
  set src(v: string | null | undefined) {
    reflectAttribute(this, SRC_ATTR, v);
  }

  get doc(): string {
    return this.getAttribute(DOC_ATTR) ?? "";
  }
  set doc(v: string | null | undefined) {
    reflectAttribute(this, DOC_ATTR, v);
  }

  // Element.moveBefore() fires this *instead of* connect/disconnect when
  // present, so the registry's add/remove handling never fires for moves.
  // The registry doesn't currently key off connect/disconnect (it watches
  // childList records), but Solid's `<For>` reorders use moveBefore on
  // browsers that support it; declaring this matches the spec-recommended
  // shape for autonomous custom elements that don't want to be torn down
  // on move.
  connectedMoveCallback(): void {}
}

/**
 * Reflect a property write back to its attribute. Two guards keep
 * reactive frameworks that re-call setters every render from generating
 * redundant `setAttribute` calls (each of which fires a
 * `MutationObserver` record): skip when the attribute already matches,
 * and remove the attribute (rather than writing `""`) when the new
 * value is null/undefined/empty.
 */
function reflectAttribute(
  el: HTMLElement,
  name: string,
  value: string | null | undefined,
): void {
  if (value == null || value === "") {
    if (el.getAttribute(name) === null) return;
    el.removeAttribute(name);
    return;
  }
  if (el.getAttribute(name) === value) return;
  el.setAttribute(name, value);
}

function upgradeProperty(el: HTMLElement, prop: string): void {
  if (!Object.prototype.hasOwnProperty.call(el, prop)) return;
  const value = (el as unknown as Record<string, unknown>)[prop];
  delete (el as unknown as Record<string, unknown>)[prop];
  (el as unknown as Record<string, unknown>)[prop] = value;
}

if (!customElements.get(PATCHWORK_VIEW_TAG)) {
  customElements.define(PATCHWORK_VIEW_TAG, PatchworkView);
}
