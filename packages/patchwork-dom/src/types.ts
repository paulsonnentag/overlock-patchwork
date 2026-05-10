export type Cleanup = void | (() => void);
export type MountResult = Cleanup | Promise<Cleanup>;

export type MountFn = (element: HTMLElement) => MountResult;

export type ElementWithHandle<T> = HTMLElement & { handle: T };
export type ElementWithValue<T> = HTMLElement & { value: T };

export function readHandle(el: HTMLElement): unknown {
  return (el as HTMLElement & { handle?: unknown }).handle;
}

export function readValue(el: HTMLElement): unknown {
  return (el as HTMLElement & { value?: unknown }).value;
}
