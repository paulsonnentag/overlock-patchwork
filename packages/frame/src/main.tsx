import { render } from "solid-js/web";

import type { Repo } from "@automerge/automerge-repo";

import { defineView } from "patchwork";

// Bundled into root.js by `vite-plugin-css-injected-by-js`; the frame
// owns its `<app-root>` host styling the same way `markdown-editor`
// owns its host. Bootstrap doesn't know this tag name exists.
import "./styles.css";

const MARKDOWN_EDITOR_SRC =
  "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/markdown-editor.json";

const STORAGE_KEY = "overlock-patchwork:root:markdown-url";

export default defineView(({ element, repo }) => {
  // @ts-expect-error: window.patchwork is set by the bootstrap, untyped here
  patchwork.registerView(MARKDOWN_EDITOR_SRC);

  const url = getOrCreateMarkdownUrl(repo);
  
  console.log("url", url);

  return render(
    () => (
      // @ts-expect-error: <markdown-editor> is a custom element, untyped JSX
      <markdown-editor url={url} />
    ),
    element,
  );
});

function getOrCreateMarkdownUrl(repo: Repo): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const handle = repo.create({
    "@patchwork": { type: "markdown" },
    title: "Untitled",
    content: "",
  });
  localStorage.setItem(STORAGE_KEY, handle.url);
  return handle.url;
}
