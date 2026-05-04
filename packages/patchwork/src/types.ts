export type PatchworkElement = HTMLElement & {
  isPatchworkView: true
}

export type Mount = (element: HTMLElement) => Promise<(() => void) | null>
