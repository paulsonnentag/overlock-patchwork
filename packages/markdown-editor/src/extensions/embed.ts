import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import {
  isValidDocumentId,
  parseAutomergeUrl,
  type DocumentId,
} from "@automerge/automerge-repo";

const PATCHWORK_DND = "text/x-patchwork-dnd";

const EMBED_BUILD_TAG = `md-embed build ${new Date().toISOString()}`;
console.log(`[md-embed] module loaded — ${EMBED_BUILD_TAG}`);

const openLinkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

export function codeMirrorEmbed() {
  console.log(`[md-embed] codeMirrorEmbed() called — ${EMBED_BUILD_TAG}`);
  return [embedPlugin, embedTheme, embedDropHandlers()];
}

class EmbedWidget extends WidgetType {
  readonly #docId: DocumentId;
  readonly #embedText: string;

  constructor(docId: DocumentId, embedText: string) {
    super();
    this.#docId = docId;
    this.#embedText = embedText;
  }

  eq(other: EmbedWidget) {
    return other.#docId === this.#docId;
  }

  toDOM() {
    console.log("[md-embed] EmbedWidget.toDOM", this.#docId);

    const container = document.createElement("div");
    container.className = "cm-embed";

    const label = document.createElement("div");
    label.className = "cm-embed-label";

    const labelText = document.createElement("span");
    labelText.className = "cm-embed-label-text";
    labelText.textContent = this.#embedText;
    labelText.title = "Click to edit";

    const openLink = document.createElement("button");
    openLink.className = "cm-embed-open-link";
    openLink.title = "Open document";
    openLink.innerHTML = openLinkIcon;
    openLink.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const params = new URLSearchParams();
      params.set("doc", `automerge:${this.#docId}`);
      window.location.hash = params.toString();
    };

    label.appendChild(labelText);
    label.appendChild(openLink);

    // patchwork-view sets `height: 100%` on itself at mount time, so it
    // needs an ancestor with a concrete height to render any space.
    const body = document.createElement("div");
    body.className = "cm-embed-body";

    const view = document.createElement("patchwork-view");
    view.setAttribute("url", `automerge:${this.#docId}`);
    view.addEventListener(
      "patchwork:mounted",
      () => console.log("[md-embed] patchwork-view mounted", this.#docId),
      { once: true }
    );
    view.addEventListener(
      "patchwork:unmounted",
      () => console.log("[md-embed] patchwork-view unmounted", this.#docId),
      { once: true }
    );
    body.appendChild(view);

    container.appendChild(label);
    container.appendChild(body);

    queueMicrotask(() => {
      console.log("[md-embed] post-insert state", {
        docId: this.#docId,
        containerInDom: container.isConnected,
        viewInDom: view.isConnected,
        viewParent: view.parentElement?.tagName,
        viewChildren: view.childElementCount,
        viewClientHeight: view.clientHeight,
      });
    });

    return container;
  }

  ignoreEvent(e: Event) {
    if (e.type === "mousedown" && e.target instanceof Element) {
      if (e.target.classList.contains("cm-embed-label-text")) return false;
      if (
        e.target.classList.contains("cm-embed-open-link") ||
        e.target.closest(".cm-embed-open-link")
      ) {
        return true;
      }
    }
    return true;
  }
}

const EMBED_RE = /\[patchwork:([^\]\s]+)\]/g;

function getEmbedLinks(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const { state } = view;
  const selection = state.selection.main;

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    for (const match of text.matchAll(EMBED_RE)) {
      const docId = match[1];
      if (!isValidDocumentId(docId)) continue;

      const linkFrom = from + (match.index ?? 0);
      const linkTo = linkFrom + match[0].length;

      const cursorInLink =
        selection.from >= linkFrom && selection.from <= linkTo;
      const selectionSpansLink =
        selection.from < linkFrom && selection.to > linkTo;
      if (cursorInLink || selectionSpansLink) continue;

      widgets.push(
        Decoration.replace({
          widget: new EmbedWidget(docId as DocumentId, match[0]),
        }).range(linkFrom, linkTo)
      );
    }
  }
  console.log(`[md-embed] decorations rebuilt — ${widgets.length} embed(s)`);
  return Decoration.set(widgets);
}

function embedDropHandlers() {
  return EditorView.domEventHandlers({
    dragenter(event) {
      console.log("[md-embed] dragenter", {
        types: event.dataTransfer?.types
          ? [...event.dataTransfer.types]
          : null,
      });
      if (!event.dataTransfer?.types.includes(PATCHWORK_DND)) return false;
      event.preventDefault();
      return true;
    },
    dragover(event) {
      const types = event.dataTransfer?.types;
      if (!types?.includes(PATCHWORK_DND)) {
        console.log("[md-embed] dragover ignored", {
          types: types ? [...types] : null,
        });
        return false;
      }
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
      return true;
    },
    drop(event, view) {
      const types = event.dataTransfer?.types;
      console.log("[md-embed] drop", {
        types: types ? [...types] : null,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (!types?.includes(PATCHWORK_DND)) {
        console.log("[md-embed] drop missing patchwork-dnd type");
        return false;
      }
      const raw = event.dataTransfer!.getData(PATCHWORK_DND);
      if (!raw) {
        console.log("[md-embed] drop empty payload");
        return false;
      }

      let data: { items?: Array<{ url?: string }> };
      try {
        data = JSON.parse(raw);
      } catch (err) {
        console.warn("[md-embed] drop JSON parse failed", err, raw);
        return false;
      }
      const items = data?.items;
      console.log("[md-embed] drop parsed payload", { data, count: items?.length });
      if (!Array.isArray(items) || items.length === 0) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      console.log("[md-embed] drop posAtCoords", pos);
      if (pos == null) return false;

      const inserts: string[] = [];
      for (const item of items) {
        if (!item?.url) {
          console.log("[md-embed] drop item missing url", item);
          continue;
        }
        const { documentId } = parseAutomergeUrl(item.url);
        if (!isValidDocumentId(documentId)) {
          console.log("[md-embed] drop invalid documentId", item.url);
          continue;
        }
        inserts.push(`[patchwork:${documentId}]`);
      }
      console.log("[md-embed] drop inserts", inserts);
      if (inserts.length === 0) return false;

      event.preventDefault();
      const text = inserts.join("\n\n");
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
      });
      return true;
    },
  });
}

const embedPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = getEmbedLinks(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged
      ) {
        this.decorations = getEmbedLinks(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

const embedTheme = EditorView.baseTheme({
  ".cm-embed": {
    display: "block",
    border: "1px solid #ddd",
    borderRadius: "4px",
    overflow: "hidden",
    margin: "8px 0",
  },
  ".cm-embed-label": {
    fontFamily: "monospace",
    padding: "4px 8px",
    borderBottom: "1px solid #ddd",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: "text",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  ".cm-embed-label-text": {
    flex: "1",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    opacity: 0.7,
  },
  ".cm-embed-label-text:hover": { opacity: 1 },
  ".cm-embed-open-link": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    cursor: "pointer",
    flexShrink: "0",
    border: "none",
    background: "none",
    padding: "0",
    color: "inherit",
    opacity: 0.7,
  },
  ".cm-embed-open-link:hover": { opacity: 1 },
  ".cm-embed-body": {
    display: "block",
    height: "500px",
    width: "100%",
    overflow: "hidden",
  },
  ".cm-embed-body patchwork-view": {
    display: "block",
    height: "100%",
    width: "100%",
  },
  ".cm-embed-body patchwork-view > *": { height: "100%", width: "100%" },
});
