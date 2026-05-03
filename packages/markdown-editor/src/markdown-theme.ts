// Ported from patchwork-next/tools/codemirror/codemirror-markdown.
// daisyUI CSS variables get fallbacks from `styles.css` so the editor
// works without daisyUI/Tailwind on the host.

import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

export function markdownTheme(style: "serif" | "sans" = "sans") {
  return [
    EditorView.theme(MARKDOWN_STYLES),
    syntaxHighlighting(markdownSyntaxHighlighting(style)),
    bullets,
  ];
}

const MARKDOWN_STYLES: Record<string, Record<string, string | number>> = {
  "&": {},
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  "&.cm-editor": {
    height: "100%",
    display: "flex",
    alignContent: "center",
    justifyContent: "center",
    overflow: "auto",
  },
  ".cm-gutter": {
    background: "transparent",
  },
  ".cm-content": {
    textWrap: "pretty",
    lineHeight: "1.5rem",
    color: "var(--color-base-content)",
    caretColor: "var(--color-base-content)",
    marginBlock: "2rem",
    marginInline: "auto",
    paddingInline: "1rem",
    maxWidth: "var(--max-text-line-width)",
    marginBottom: "8em",
  },
  ".cm-content li": {
    marginBottom: 0,
  },
  ".cm-activeLine": {
    backgroundColor: "inherit",
  },
  ".frontmatter, .frontmatter *": {
    fontSize: "14px",
    fontFamily: "monospace",
    color: "#666",
    textDecoration: "none",
    fontWeight: "normal",
    lineHeight: "0.8em",
  },
  ".cm-gutters": {
    borderRight: "0",
    border: "0",
    background: "transparent",
  },
};

const baseHeadingStyles = {
  fontFamily: '"Merriweather Sans", sans-serif',
  fontWeight: 400,
  textDecoration: "none",
};

const baseCodeStyles = {
  fontFamily: "monospace",
  fontSize: "1em",
};

const markdownSyntaxHighlighting = (style: "serif" | "sans") =>
  HighlightStyle.define([
    {
      tag: tags.content,
      fontFamily:
        style === "serif"
          ? '"Merriweather", serif'
          : '"Merriweather Sans", sans-serif',
    },
    {
      tag: tags.heading1,
      ...baseHeadingStyles,
      fontSize: "1.5rem",
      lineHeight: "2rem",
      marginBottom: "1rem",
      marginTop: "2rem",
    },
    {
      tag: tags.heading2,
      ...baseHeadingStyles,
      fontSize: "1.5rem",
      lineHeight: "2rem",
      marginBottom: "1rem",
      marginTop: "2rem",
    },
    {
      tag: tags.heading3,
      ...baseHeadingStyles,
      fontSize: "1.25rem",
      lineHeight: "1.75rem",
      marginBottom: "1rem",
      marginTop: "2rem",
    },
    {
      tag: tags.heading4,
      ...baseHeadingStyles,
      fontSize: "1.1rem",
      marginBottom: "1rem",
      marginTop: "2rem",
    },
    {
      tag: tags.comment,
      color: "#555",
      fontFamily: "monospace",
    },
    { tag: tags.quote, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    {
      tag: [tags.meta],
      fontWeight: 300,
      color: "#999",
      fontFamily: '"Merriweather Sans", sans-serif',
    },
    { tag: tags.keyword, ...baseCodeStyles, color: "#708" },
    {
      tag: [
        tags.atom,
        tags.bool,
        tags.url,
        tags.contentSeparator,
        tags.labelName,
      ],
      ...baseCodeStyles,
      color: "var(--color-secondary)",
    },
    { tag: [tags.literal, tags.inserted], ...baseCodeStyles, color: "#164" },
    { tag: [tags.string, tags.deleted], ...baseCodeStyles, color: "#5f67b5" },
    {
      tag: [tags.regexp, tags.escape, tags.special(tags.string)],
      ...baseCodeStyles,
      color: "#e40",
    },
    {
      tag: tags.definition(tags.variableName),
      ...baseCodeStyles,
      color: "#00f",
    },
    { tag: tags.local(tags.variableName), ...baseCodeStyles, color: "#30a" },
    { tag: [tags.typeName, tags.namespace], ...baseCodeStyles, color: "#085" },
    { tag: tags.className, ...baseCodeStyles, color: "#167" },
    {
      tag: [tags.special(tags.variableName), tags.macroName],
      ...baseCodeStyles,
      color: "#256",
    },
    {
      tag: tags.definition(tags.propertyName),
      ...baseCodeStyles,
      color: "#00c",
    },
    { tag: tags.monospace, ...baseCodeStyles },
  ]);

// Replace markdown bullet markers (`-`, `+`, `*`) with a single `•`
// glyph so prose-mode lists read like rendered output without leaving
// the source view.
const bullets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    readonly #view: EditorView;

    constructor(view: EditorView) {
      this.#view = view;
      this.decorations = this.#build();
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.#build();
      }
    }

    #build(): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const doc = this.#view.state.doc;
      syntaxTree(this.#view.state).iterate({
        enter: ({ type, from }) => {
          if (type.name === "ListMark") {
            const char = doc.sliceString(from, from + 1);
            if (["-", "+", "*"].includes(char)) {
              builder.add(
                from,
                from + 1,
                Decoration.replace({ widget: new BulletWidget() }),
              );
            }
          }
        },
      });
      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "•";
    span.className = "cm-bullet";
    return span;
  }
}
