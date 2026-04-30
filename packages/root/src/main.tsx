import { render } from "solid-js/web";

// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `root.js` and a `<style>` tag is
// inserted on first import. Keeps the package a single self-contained
// JS file for the loader to fetch.
import "./styles.css";

const MARKDOWN_EDITOR_SRC =
  "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/markdown-editor.json";

const STORAGE_KEY = "overlock-patchwork:root:markdown-url";

type Repo = {
  create: (doc: object) => { url: string };
};

type ViewElement = HTMLElement & {
  repo: Repo;
};

export default function (element: ViewElement): () => void {
  const url = ensureMarkdownUrl(element.repo);
  return render(
    () => <patchwork-view src={MARKDOWN_EDITOR_SRC} doc={url} />,
    element,
  );
}

function ensureMarkdownUrl(repo: Repo): string {
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
