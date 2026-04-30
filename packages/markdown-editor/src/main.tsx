import { render } from "solid-js/web";

import { EditorView, keymap } from "@codemirror/view";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

import { parseAutomergeUrl } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";

import { CodeMirror } from "./codemirror";
import { markdownTheme } from "./markdown-theme";
// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `markdown-editor.js` and a
// `<style>` tag is inserted on first import. Keeps the package a
// single self-contained JS file for the loader to fetch.
import "./styles.css";

type TextDoc = { content?: string };

type ViewElement = HTMLElement & {
  handle?: DocHandle<TextDoc>;
};

const PATH = ["content"] as const;

export default function (element: ViewElement) {
  const handle = element.handle;
  if (!handle) {
    return renderPlaceholder(element);
  }

  const isReadOnly = !!parseAutomergeUrl(handle.url).heads;

  const dispose = render(
    () => <Editor handle={handle} isReadOnly={isReadOnly} />,
    element,
  );

  return dispose;
}

function Editor(props: {
  handle: DocHandle<TextDoc>;
  isReadOnly: boolean;
}) {
  const baseExtensions = [
    markdown(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    ...markdownTheme("sans"),
  ];

  return (
    <CodeMirror
      handle={props.handle}
      path={[...PATH]}
      extensions={baseExtensions}
      readOnly={props.isReadOnly}
    />
  );
}

function renderPlaceholder(element: ViewElement): () => void {
  const placeholder = document.createElement("textarea");
  placeholder.disabled = true;
  placeholder.placeholder = "Select a document";
  element.append(placeholder);
  return () => {
    placeholder.remove();
  };
}
