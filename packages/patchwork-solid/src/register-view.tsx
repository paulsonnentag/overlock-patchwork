import {
  Show,
  createResource,
  splitProps,
  type Component,
  type JSX,
} from "solid-js"
import { Dynamic } from "solid-js/web"

import { getViewRegistry } from "patchwork-dom"

export const MOUNTED_EVENT = "patchwork:mounted"
export const UNMOUNTED_EVENT = "patchwork:unmounted"

export type ViewWrapperProps = JSX.HTMLAttributes<HTMLElement> & {
  url?: string
  onMounted?: (element: HTMLElement) => void
}

export function registerView(
  element: HTMLElement,
  manifestUrl: string,
): Component<ViewWrapperProps> {
  const registry = getViewRegistry(element)
  const promise = registry.registerView(manifestUrl).catch((err: unknown) => {
    console.error("[patchwork-solid] registerView failed", manifestUrl, err)
    return undefined
  })

  return (props: ViewWrapperProps): JSX.Element => {
    const [tag] = createResource(() => promise)
    const [local, rest] = splitProps(props, ["onMounted"])

    const onElement = (el: HTMLElement) => {
      if (!local.onMounted) return
      el.addEventListener(MOUNTED_EVENT, () => local.onMounted!(el), {
        once: true,
      })
    }

    return (
      <Show when={tag()}>
        {(resolved) => (
          <Dynamic component={resolved()} {...rest} ref={onElement} />
        )}
      </Show>
    )
  }
}
