import { createRoot } from "react-dom/client";

import { withDocHandle } from "patchwork-dom";

import type { TLDrawDoc } from "./datatype";
// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `tldraw-editor.js` and a
// `<style>` tag is inserted on first import. Keeps the package a
// single self-contained JS file for the loader to fetch.
import "./styles.css";

// Bump on every change so the console shows which build is live.
const BUILD = 4;

console.log(`[tldraw-editor] loaded build ${BUILD}`);

export default withDocHandle<TLDrawDoc>(async ({ element, handle, repo }) => {
  element.style.display = "block";
  element.style.width = "100%";
  element.style.height = "100%";

  const root = createRoot(element);
  const { TldrawTool } = await import("./tool");
  const { RepoContext } = await import(
    "@automerge/automerge-repo-react-hooks"
  );
  root.render(
    <RepoContext.Provider value={repo}>
      <TldrawTool docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
});
