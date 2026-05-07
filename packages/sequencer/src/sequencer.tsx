import { createRoot } from "react-dom/client";

import { withDocHandle } from "patchwork-dom";

import { Sequencer } from "./tool";
import type { SequencerDoc } from "./datatype";
// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `sequencer.js` and a `<style>`
// tag is inserted on first import. Keeps the package a single
// self-contained JS file for the loader to fetch.
import "./style.css";

export default withDocHandle<SequencerDoc>(({ element, handle }) => {
  const root = createRoot(element);
  root.render(<Sequencer handle={handle} />);
  return () => root.unmount();
});
