import { Component, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { withDocHandle } from "patchwork-dom";

import type { MergecraftDoc } from "./datatype";
// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `mergecraft.js` and a `<style>`
// tag is inserted on first import. Keeps the package a single
// self-contained JS file for the loader to fetch.
import "./style.css";

const TAG = "[mergecraft-editor]";

class MountErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error(`${TAG} React render error`, error, info);
  }
  render() {
    if (this.state.error) {
      return createElement(
        "pre",
        {
          style: {
            position: "absolute",
            inset: 0,
            margin: 0,
            padding: "1rem",
            background: "#200",
            color: "#fbb",
            font: "12px/1.4 ui-monospace, monospace",
            whiteSpace: "pre-wrap",
            zIndex: 999999,
            overflow: "auto",
          },
        },
        `${this.state.error.name}: ${this.state.error.message}\n\n${this.state.error.stack ?? ""}`,
      );
    }
    return this.props.children;
  }
}

export default withDocHandle<MergecraftDoc>(async ({ element, handle }) => {
  console.log(`${TAG} mount fn start`, { element, handle, url: handle.url });
  // Custom elements default to `display: inline` with no intrinsic
  // size; R3F's <Canvas> would then collapse to its 300x150 default.
  element.style.display = "block";
  element.style.width = "100%";
  element.style.height = "100%";

  const root = createRoot(element);
  console.log(`${TAG} root created, awaiting ./tool`);

  let Mergecraft: (props: { handle: typeof handle }) => ReactNode;
  try {
    const mod = await import("./tool");
    Mergecraft = mod.default;
    console.log(`${TAG} ./tool resolved`, { Mergecraft });
  } catch (err) {
    console.error(`${TAG} ./tool import failed`, err);
    element.textContent = `mergecraft: failed to load tool chunk\n${String(err)}`;
    return () => root.unmount();
  }

  try {
    root.render(
      createElement(
        MountErrorBoundary,
        null,
        createElement(Mergecraft, { handle }),
      ),
    );
    console.log(`${TAG} root.render returned`);
  } catch (err) {
    console.error(`${TAG} root.render threw synchronously`, err);
    element.textContent = `mergecraft: render threw\n${String(err)}`;
  }
  return () => root.unmount();
});
