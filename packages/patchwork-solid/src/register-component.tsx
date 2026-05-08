import {
  Show,
  createResource,
  splitProps,
  type Component,
  type JSX,
} from "solid-js"
import { Dynamic } from "solid-js/web"

import { getComponentRegistry } from "patchwork-dom"

export const MOUNTED_EVENT = "patchwork:mounted"
export const UNMOUNTED_EVENT = "patchwork:unmounted"

export type ComponentWrapperProps = JSX.HTMLAttributes<HTMLElement> & {
  url?: string
  onMounted?: (element: HTMLElement) => void
}

export function registerComponent(
  element: HTMLElement,
  componentUrl: string,
): Component<ComponentWrapperProps> {
  const componentRegistry = getComponentRegistry(element)
  const promise = componentRegistry
    .register(componentUrl)
    .catch((err: unknown) => {
      console.error(
        "[patchwork-solid] registerComponent failed",
        componentUrl,
        err,
      )
      return undefined
    })

  return (props: ComponentWrapperProps): JSX.Element => {
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
