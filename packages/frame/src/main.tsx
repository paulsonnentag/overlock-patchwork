import { render } from "solid-js/web";

import type { Repo } from "@automerge/automerge-repo";
import type { ViewElement } from "patchwork-types";

const MARKDOWN_EDITOR_SRC =
  "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/markdown-editor.json";

const STORAGE_KEY = "overlock-patchwork:root:markdown-url";

export default function (element: ViewElement): () => void {
  const url = ensureMarkdownUrl(element.repo);
  return render(
    () => (
      <patchwork-view src={MARKDOWN_EDITOR_SRC} doc={url} />
    ),
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
