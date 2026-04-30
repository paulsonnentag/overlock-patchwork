import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { JSX } from "solid-js";

export type ViewElement<V = unknown> = HTMLElement & {
  handle?: DocHandle<V>;
  repo: Repo;
  context: <T>(predicate: (value: unknown) => value is T) => T | null;
};

export type MountFn<V = unknown> = (
  element: ViewElement<V>,
) => Promise<(() => void) | void> | ((() => void) | void);

// Open the Solid JSX namespace so any hyphenated custom element (or
// otherwise-unknown tag) typechecks with arbitrary attributes.
// Component packages embedding `<patchwork-view>` and similar tags
// pick this up automatically by importing anything from the package.
declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      [tagName: string]: JSX.HTMLAttributes<HTMLElement> & {
        [attr: string]: unknown;
      };
    }
  }
}
