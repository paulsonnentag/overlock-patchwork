export type Mount = (
  element: HTMLElement,
) => undefined | (() => void) | Promise<undefined | (() => void)>
