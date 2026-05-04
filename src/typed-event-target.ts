// Adds typed `addEventListener` / `removeEventListener` overloads on top of
// `EventTarget`. Implemented via interface merging so the inherited DOM
// implementation also satisfies the narrower typed signature — a real method
// body can't be compatible with both at once.
export interface TypedEventTarget<EventMap extends Record<string, Event>> {
  addEventListener<K extends keyof EventMap & string>(
    type: K,
    listener: (this: this, ev: EventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof EventMap & string>(
    type: K,
    listener: (this: this, ev: EventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
}

export class TypedEventTarget<
  EventMap extends Record<string, Event>,
> extends EventTarget {}
