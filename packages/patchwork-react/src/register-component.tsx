import {
  createElement,
  useEffect,
  useState,
  type ComponentType,
  type HTMLAttributes,
  type ReactElement,
} from "react"

import { getComponentRegistry } from "patchwork-dom"

export const MOUNTED_EVENT = "patchwork:mounted"
export const UNMOUNTED_EVENT = "patchwork:unmounted"

export type ComponentWrapperProps = HTMLAttributes<HTMLElement> & {
  url?: string
  onMounted?: (element: HTMLElement) => void
}

export function registerComponent(
  element: HTMLElement,
  componentUrl: string,
): ComponentType<ComponentWrapperProps> {
  const componentRegistry = getComponentRegistry(element)
  let resolved: string | undefined
  const promise = componentRegistry
    .register(componentUrl)
    .then((tag) => {
      resolved = tag
      return tag
    })
    .catch((err: unknown) => {
      console.error(
        "[patchwork-react] registerComponent failed",
        componentUrl,
        err,
      )
      return undefined
    })

  return (props: ComponentWrapperProps): ReactElement | null => {
    const [tag, setTag] = useState<string | undefined>(resolved)

    useEffect(() => {
      if (resolved) {
        if (tag !== resolved) setTag(resolved)
        return
      }
      let cancelled = false
      void promise.then((t) => {
        if (!cancelled && t) setTag(t)
      })
      return () => {
        cancelled = true
      }
    }, [])

    if (!tag) return null

    const { onMounted, ...rest } = props
    const ref = (el: HTMLElement | null) => {
      if (!el || !onMounted) return
      el.addEventListener(MOUNTED_EVENT, () => onMounted(el), { once: true })
    }
    return createElement(tag, { ...rest, ref })
  }
}
