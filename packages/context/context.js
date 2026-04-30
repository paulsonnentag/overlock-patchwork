/**
 * Wrap a regular mount fn so that the host element doubles as a
 * context value carrier for descendants. Inside the wrapped mount fn
 * the element gains:
 *
 *   element.source = …;                     // publish a value
 *   element.value;                          // last published value
 *   element.addEventListener("change", …);  // subscribe (descendants)
 *
 * `source` accepts two shapes:
 *
 * 1. A plain value — copied into `value`, dispatches `change` once
 *    per new reference (deduped by `Object.is`).
 * 2. An upstream subscribable — anything that's an `EventTarget` with
 *    a `value` property (e.g. a Handle<T>, another defineContext-wrapped
 *    view). The wrapper subscribes, mirrors `value`, re-dispatches
 *    `change`, and unsubscribes on cleanup. A `DocHandle` does *not*
 *    satisfy this shape (no `.value`) — pass the handle directly and
 *    let descendants read `.doc()` off the published value.
 *
 * Discovery from below uses `el.context(predicate)`. The framework's
 * walk treats any custom-element ancestor (tag name with a hyphen)
 * exposing a `.value` property as a context candidate; the predicate
 * runs against `value`. Built-in form elements (`<input>`, `<select>`,
 * etc.) have native `.value` but no hyphen in their tag name, so
 * they're skipped by the walk — your custom-tag context view will not
 * be confused with native value-carriers.
 *
 * The inner mount fn keeps the standard contract: same signature
 * (`(element) => Promise<cleanup | void> | cleanup | void`), free to
 * be sync or async, and its returned cleanup composes with the
 * wrapper's own subscription teardown.
 */
export function defineContext(mountFn) {
  return async function mountContext(element) {
    let value = null;
    let source = null;
    let unsubscribe = null;

    Object.defineProperty(element, "value", {
      get: () => value,
      configurable: true,
    });

    Object.defineProperty(element, "source", {
      get: () => source,
      set: (input) => {
        if (input === source) return;
        unsubscribe?.();
        unsubscribe = null;
        source = input;
        if (input instanceof EventTarget && "value" in input) {
          const onUpstreamChange = () => emit(input.value);
          input.addEventListener("change", onUpstreamChange);
          unsubscribe = () =>
            input.removeEventListener("change", onUpstreamChange);
          emit(input.value);
        } else {
          emit(input);
        }
      },
      configurable: true,
    });

    const emit = (next) => {
      if (Object.is(next, value)) return;
      value = next;
      element.dispatchEvent(new Event("change"));
    };

    const userCleanup = await mountFn(element);

    return () => {
      unsubscribe?.();
      if (typeof userCleanup === "function") userCleanup();
    };
  };
}
