import { render } from "solid-js/web";

import { EditorView, keymap } from "@codemirror/view";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

import { getComponentRegistry, withDocHandle } from "patchwork-dom";

import { CodeMirror } from "./codemirror";
import { createDiffDecorations } from "./extensions/diffDecorations";
import { codeMirrorEmbed } from "./extensions/embed";
import { markdownTheme } from "./markdown-theme";
// `vite-plugin-css-injected-by-js` rewrites this side-effect import at
// build time: the CSS is bundled into `markdown-editor.js` and a
// `<style>` tag is inserted on first import. Keeps the package a
// single self-contained JS file for the loader to fetch.
import "./styles.css";

type MarkdownDoc = { content?: string };

const PATH = ["content"];

const PATCHWORK_VIEW_URL =
  "automerge:2GJUXWeXXtSuEEmuRcThJ85TgLBv/dist/patchwork-view-component.json";

export default withDocHandle<MarkdownDoc>(({ element, handle }) => {
  // Embedded `[patchwork:<id>]` widgets render a <patchwork-view> tag;
  // pre-register it so the ancestor registry can mount it on insert.
  const registry = getComponentRegistry(element);
  console.log("[md-embed] registering patchwork-view", PATCHWORK_VIEW_URL);
  registry
    .register(PATCHWORK_VIEW_URL)
    .then((name) =>
      console.log("[md-embed] patchwork-view registered as", name)
    )
    .catch((err: unknown) => {
      console.error(
        "[md-embed] failed to register patchwork-view",
        err
      );
    });

  const extensions = [
    markdown(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    ...markdownTheme("sans"),
    ...codeMirrorEmbed(),
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
    element
  );
});
