import type { JSX } from "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": JSX.HTMLAttributes<HTMLElement> & {
        src?: string;
        doc?: string;
      };
    }
  }
}
