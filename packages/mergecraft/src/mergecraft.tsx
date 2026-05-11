import { createRoot } from "react-dom/client";

import { withDocHandle } from "patchwork-dom";

import type { MergecraftDoc } from "./datatype";
// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `mergecraft.js` and a `<style>`
// tag is inserted on first import. Keeps the package a single
// self-contained JS file for the loader to fetch.
import "./style.css";

export default withDocHandle<MergecraftDoc>(async ({ element, handle }) => {
  // Custom elements default to `display: inline` with no intrinsic
  // size; R3F's <Canvas> would then collapse to its 300x150 default.
  element.style.display = "block";
  element.style.width = "100%";
  element.style.height = "100%";

  const root = createRoot(element);
  const { default: Mergecraft } = await import("./tool");
  root.render(<Mergecraft handle={handle} />);
  return () => root.unmount();
});
