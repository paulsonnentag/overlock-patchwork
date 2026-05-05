import { Show, createResource, splitProps, type Component, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"

import {
  defineView as baseDefineView,
  type Mount,
  type ViewElement,
  type ViewProps as CoreViewProps,
} from "patchwork-view"

export const MOUNTED_EVENT = "patchwork:mounted"
export const UNMOUNTED_EVENT = "patchwork:unmounted"

export type ViewWrapperProps<V = unknown> = JSX.HTMLAttributes<HTMLElement> & {
  url?: string
  onMounted?: (element: ViewElement<V>) => void
}

export type RegisterView = <V = unknown>(
  manifestUrl: string,
) => Component<ViewWrapperProps<V>>

export type ViewProps<V = unknown> = Omit<CoreViewProps<V>, "registerView"> & {
  registerView: RegisterView
}

export type ViewFn<V = unknown> = (
  props: ViewProps<V>,
) => undefined | (() => void) | Promise<undefined | (() => void)>

export function defineView<V = unknown>(viewFn: ViewFn<V>): Mount {
  return baseDefineView<V>((coreProps) => {
    const { registerView: coreRegister, ...rest } = coreProps

    const registerView: RegisterView = <W = unknown,>(manifestUrl: string) => {
      const promise = coreRegister(manifestUrl).catch((err) => {
        console.error("[solid-patchwork] registerView failed", manifestUrl, err)
        return undefined
      })

      return (props: ViewWrapperProps<W>) => {
        const [tag] = createResource(() => promise)
        const [local, rest] = splitProps(props, ["onMounted"])

        const onElement = (el: HTMLElement) => {
          if (!local.onMounted) return
          el.addEventListener(
            MOUNTED_EVENT,
            () => local.onMounted!(el as ViewElement<W>),
            { once: true },
          )
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

    return viewFn({ ...rest, registerView } as ViewProps<V>)
  })
}
