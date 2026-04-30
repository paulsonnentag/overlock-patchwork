import { render } from "solid-js/web";

import { EditorView, keymap } from "@codemirror/view";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

import { parseAutomergeUrl } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";

import { CodeMirror } from "./codemirror";

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
    () => (
      <Editor handle={handle} isReadOnly={isReadOnly} />
    ),
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
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": {
        font: '14px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      },
      ".cm-content": { padding: "1rem 1.25rem" },
    }),
  ];

  return (
    <>
      <style>{STYLES}</style>
      <CodeMirror
        handle={props.handle}
        path={[...PATH]}
        extensions={baseExtensions}
        readOnly={props.isReadOnly}
      />
    </>
  );
}

function renderPlaceholder(element: ViewElement): () => void {
  const style = document.createElement("style");
  style.textContent = STYLES;
  const placeholder = document.createElement("textarea");
  placeholder.disabled = true;
  placeholder.placeholder = "Select a document";
  element.append(style, placeholder);
  return () => {
    style.remove();
    placeholder.remove();
  };
}

const STYLES = `
  markdown-editor { display: flex; flex: 1 1 auto; min-height: 0; }
  markdown-editor textarea {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 1rem 1.25rem;
    margin: 0;
    font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: inherit;
    background: transparent;
    border: 0;
    resize: none;
    outline: none;
  }
  markdown-editor textarea:disabled { color: #9ca3af; }
  markdown-editor .cm-editor { flex: 1 1 auto; min-height: 0; height: 100%; }
  markdown-editor .cm-editor.cm-focused { outline: none; }
`;
