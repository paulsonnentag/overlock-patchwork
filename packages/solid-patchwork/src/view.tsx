import { Show, createResource, type Component, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"

import {
  defineView as baseDefineView,
  type Mount,
  type ViewProps as CoreViewProps,
} from "patchwork"

export type ViewWrapperProps = JSX.HTMLAttributes<HTMLElement> & {
  url?: string
}

export type RegisterView = (manifestUrl: string) => Component<ViewWrapperProps>

export type ViewProps<V = unknown> = Omit<CoreViewProps<V>, "registerView"> & {
  registerView: RegisterView
}

export type ViewFn<V = unknown> = (
  props: ViewProps<V>,
) => undefined | (() => void) | Promise<undefined | (() => void)>

export function defineView<V = unknown>(viewFn: ViewFn<V>): Mount {
  return baseDefineView<V>((coreProps) => {
    const { registerView: coreRegister, ...rest } = coreProps

    const registerView: RegisterView = (manifestUrl) => {
      const promise = coreRegister(manifestUrl).catch((err) => {
        console.error("[solid-patchwork] registerView failed", manifestUrl, err)
        return undefined
      })

      return (props) => {
        const [tag] = createResource(() => promise)
        return (
          <Show when={tag()}>
            {(resolved) => <Dynamic component={resolved()} {...props} />}
          </Show>
        )
      }
    }

    return viewFn({ ...rest, registerView } as ViewProps<V>)
  })
}
