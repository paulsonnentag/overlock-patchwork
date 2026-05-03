import { render } from "solid-js/web";

import type { DocHandle } from "@automerge/automerge-repo";
import type { ViewElement } from "patchwork-types";
import { arithmetic, type Sheet } from "spreadsheet";

import { Spreadsheet } from "./Spreadsheet";
import "./styles.css";

export { Spreadsheet, type SpreadsheetProps } from "./Spreadsheet";

export default function (element: ViewElement<Sheet>) {
  const handle = asDocHandle<Sheet>(element.source);
  if (!handle) return renderPlaceholder(element);

  const dispose = render(
    () => <Spreadsheet handle={handle} language={arithmetic} />,
    element,
  );

  return dispose;
}

function asDocHandle<T>(source: unknown): DocHandle<T> | null {
  // Duck-typed: the runtime stamps `source` from `@automerge/automerge-repo/slim`,
  // we import types from `@automerge/automerge-repo` — `instanceof` would
  // cross identity boundaries and fail. The shape check is what view.ts
  // uses internally.
  if (
    typeof source === "object" &&
    source !== null &&
    typeof (source as { doc?: unknown }).doc === "function" &&
    typeof (source as { on?: unknown }).on === "function" &&
    typeof (source as { off?: unknown }).off === "function" &&
    typeof (source as { change?: unknown }).change === "function"
  ) {
    return source as DocHandle<T>;
  }
  return null;
}

function renderPlaceholder(element: HTMLElement): () => void {
  const placeholder = document.createElement("div");
  placeholder.className = "ss-placeholder";
  placeholder.textContent = "Select a sheet";
  element.append(placeholder);
  return () => placeholder.remove();
}
