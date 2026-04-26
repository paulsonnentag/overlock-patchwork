import * as componentStore from "./component-store.js";
import type {
  ComponentRoot,
  Schema,
  SchemaComponentRoot,
} from "./types.js";

/**
 * Walk up the DOM from `start` (inclusive) returning the first element
 * that is a registered component and — if a schema is provided — whose
 * `handle.doc()` parses under the schema. Elements without a `handle` are
 * skipped under schema filtering and returned under no-schema lookups.
 *
 * Pure DOM walk + `componentStore` reads. No registry state required, so
 * the walker is safe to expose as an element method without coupling
 * elements back to a `ComponentRegistry` instance.
 */
function findComponent<T>(
  start: Element | null,
  schema: Schema<T>,
): SchemaComponentRoot<T> | null;
function findComponent(start: Element | null): ComponentRoot | null;
function findComponent<T>(
  start: Element | null,
  schema?: Schema<T>,
): ComponentRoot | SchemaComponentRoot<T> | null {
  let cur: Element | null = start;
  while (cur) {
    if (cur instanceof HTMLElement && componentStore.lookup(cur)) {
      const el = cur as ComponentRoot;
      if (!schema) return el;
      const handle = el.handle;
      if (handle) {
        try {
          schema.parse(handle.doc());
          return el as SchemaComponentRoot<T>;
        } catch {
          // not a match, keep walking
        }
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Stamp `closestComponent` and `ancestorComponent` onto a freshly mounted
 * component element. Call once per Component, synchronously, before any
 * `await` so a child mount fn can rely on the methods being present.
 *
 * Methods close over `el` so detached calls (`const f = el.closestComponent`)
 * still resolve against the right element.
 */
export function stampLookups(el: HTMLElement): void {
  const root = el as ComponentRoot;
  function closestComponent<T>(
    schema: Schema<T>,
  ): SchemaComponentRoot<T> | null {
    return findComponent(el, schema);
  }
  function ancestorComponent(): ComponentRoot | null;
  function ancestorComponent<T>(
    schema: Schema<T>,
  ): SchemaComponentRoot<T> | null;
  function ancestorComponent<T>(
    schema?: Schema<T>,
  ): ComponentRoot | SchemaComponentRoot<T> | null {
    return schema
      ? findComponent(el.parentElement, schema)
      : findComponent(el.parentElement);
  }
  root.closestComponent = closestComponent;
  root.ancestorComponent = ancestorComponent;
}
