export type Cleanup = void | (() => void)
export type MountResult = Cleanup | Promise<Cleanup>

export type MountFn = (element: HTMLElement) => MountResult
