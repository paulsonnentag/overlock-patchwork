export type PatchworkElement = HTMLElement & {
  isPatchworkView: true
}

export type Mount = (
  element: HTMLElement,
) => undefined | (() => void) | Promise<undefined | (() => void)>
