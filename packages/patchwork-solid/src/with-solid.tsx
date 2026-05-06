import {
  Show,
  createResource,
  splitProps,
  type Component,
  type JSX,
} from "solid-js"
import { Dynamic } from "solid-js/web"

import {
  withContext,
  type Ctx,
  type Handler,
  type Mount,
  type ViewElement,
  type WithContextCtx,
} from "patchwork-dom"

export const MOUNTED_EVENT = "patchwork:mounted"
export const UNMOUNTED_EVENT = "patchwork:unmounted"

export type ViewWrapperProps<V = unknown> = JSX.HTMLAttributes<HTMLElement> & {
  url?: string
  onMounted?: (element: ViewElement<V>) => void
}

export type RegisterView = <V = unknown>(
  manifestUrl: string,
) => Component<ViewWrapperProps<V>>

export type WithSolidCtx = Omit<WithContextCtx, "registerView"> & {
  registerView: RegisterView
}

export function withSolid<C extends Ctx>(
  next: Handler<C & WithSolidCtx>,
): Mount<C> {
  return withContext<C>((ctx) => {
    const baseRegister = ctx.registerView
    const registerView: RegisterView = <W = unknown,>(manifestUrl: string) => {
      const promise = baseRegister(manifestUrl).catch((err) => {
        console.error("[patchwork-solid] registerView failed", manifestUrl, err)
        return undefined
      })

      return (props: ViewWrapperProps<W>): JSX.Element => {
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

    return next({ ...ctx, registerView })
  })
}
