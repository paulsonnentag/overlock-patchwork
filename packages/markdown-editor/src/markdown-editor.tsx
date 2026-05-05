import { render } from "solid-js/web";

import { EditorView, keymap } from "@codemirror/view";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

import { parseAutomergeUrl } from "@automerge/automerge-repo";

import { defineView, type ViewElement } from "patchwork-solid";

import { CodeMirror } from "./codemirror";
import { createDiffDecorations } from "./extensions/diffDecorations";
import { markdownTheme } from "./markdown-theme";
// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `markdown-editor.js` and a
// `<style>` tag is inserted on first import. Keeps the package a
// single self-contained JS file for the loader to fetch.
import "./styles.css";

type TextDoc = { content?: string };

const PATH = ["content"];

export default defineView<TextDoc>(({ element }) => {
  const handle = element.handle;
  if (!handle) return;

  const extensions = [
    markdown(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    ...markdownTheme("sans"),
  ];

  const decorations = createDiffDecorations(() => handle, PATH);

  return render(
    () => (
      <CodeMirror
        handle={handle}
        path={PATH}
        extensions={extensions}
        decorations={decorations}
      />
    ),
    element,
  );
});

