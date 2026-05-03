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
