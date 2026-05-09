// Subscribe to attribute changes on `element`, listening on both the
// property setter (synchronous, picks up framework writes like Solid's
// `el.url = ...`) and a MutationObserver (catches plain `setAttribute`).
// Initial values are NOT delivered — read them via `element[name]` or
// `element.getAttribute(name)` if you want them.
export function observeAttributes(
  element: HTMLElement,
  handlers: Record<string, (value: string | null) => void>,
): () => void {
  const last: Record<string, string | null> = {}
  const names = Object.keys(handlers)

  const notify = (name: string): void => {
    const value = element.getAttribute(name)
    if (last[name] === value) return
    last[name] = value
    handlers[name](value)
  }

  for (const name of names) {
    const pending = (element as unknown as Record<string, unknown>)[name]
    Object.defineProperty(element, name, {
      get: () => element.getAttribute(name),
      set: (value) => {
        if (value == null) {
          if (element.hasAttribute(name)) element.removeAttribute(name)
        } else if (value !== element.getAttribute(name)) {
          element.setAttribute(name, String(value))
        }
        notify(name)
      },
      configurable: true,
    })
    // Salvage a pending property write (e.g. Solid wrote `el.url = ...`
    // before mount installed this setter). Seed `last` after the replay
    // so it doesn't count as a change.
    if (pending != null && String(pending) !== element.getAttribute(name)) {
      element.setAttribute(name, String(pending))
    }
    last[name] = element.getAttribute(name)
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const name = m.attributeName
      if (name && name in handlers) notify(name)
    }
  })
  observer.observe(element, { attributes: true, attributeFilter: names })

  return () => observer.disconnect()
}
