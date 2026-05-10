import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { RangeSet } from "@codemirror/state";
import { Decoration, WidgetType, type DecorationSet } from "@codemirror/view";

import type { Patch, Prop } from "@automerge/automerge";
import {
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";

type TextDoc = { content?: string };

export function createDiffDecorations(
  handle: () => DocHandle<TextDoc> | undefined,
  path: Prop[]
): () => DecorationSet {
  const [version, setVersion] = createSignal(0);

  // The doc's "change" event fires synchronously while
  // `automergeSyncPlugin` is dispatching a CodeMirror update. Bumping
  // the signal inline would cascade through the decorations effect into
  // a re-entrant `view.dispatch` (CM throws "update in progress"). Defer
  // to a microtask so the bump lands after CM's update finishes.
  let scheduled = false;
  const bump = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      setVersion((v) => v + 1);
    });
  };

  createEffect(() => {
    const h = handle();
    if (!h) return;
    h.on("change", bump);
    h.on("heads-changed", bump);
    onCleanup(() => {
      h.off("change", bump);
      h.off("heads-changed", bump);
    });
  });

  // TODO: `cloneUrl` will move onto DocHandle itself; drop the cast then.
  const cloneUrl = createMemo<AutomergeUrl | null>(() => {
    version();
    return ((handle() as unknown as { cloneUrl?: AutomergeUrl | null })
      ?.cloneUrl ?? null) as AutomergeUrl | null;
  });

  const preForkText = createMemo<string | undefined>(() => {
    const url = cloneUrl();
    const h = handle();
    if (!url || !h) return undefined;
    const { heads } = parseAutomergeUrl(url);
    if (!heads) return undefined;
    return lookup<string>(h.view(heads).doc(), path);
  });

  return () => {
    version();
    const h = handle();
    if (!h) return Decoration.none;
    // TODO: `diff` will move onto DocHandle itself; drop the cast then.
    const patches = (h as unknown as { diff?: () => Patch[] }).diff?.() ?? [];
    if (patches.length === 0) return Decoration.none;
    return buildDecorations(patches, path, preForkText());
  };
}

function buildDecorations(
  patches: Patch[],
  path: Prop[],
  preForkText: string | undefined
): DecorationSet {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  const ranges = patches.flatMap((patch) => {
    if (!matchesPath(patch.path, path)) return [];
    const index = patch.path[path.length];
    if (typeof index !== "number") return [];

    if (patch.action === "splice") {
      const value = patch.value;
      if (typeof value !== "string" || value.length === 0) return [];
      return Decoration.mark({
        attributes: {
          style: `
            border-bottom: 2px solid ${isDark ? "#4ade80" : "#22c55e"};
            background-color: ${isDark ? "#14532d" : "#dcfce7"};
          `,
        },
      }).range(index, index + value.length);
    }

    if (patch.action === "del") {
      const length = patch.length ?? 1;
      const deleted = preForkText?.slice(index, index + length) ?? "";
      return Decoration.widget({
        widget: new DeletionMarker(deleted),
        side: 1,
      }).range(index);
    }

    return [];
  });

  return RangeSet.of(ranges, true);
}

function matchesPath(patchPath: Prop[], expected: Prop[]): boolean {
  if (patchPath.length < expected.length + 1) return false;
  for (let i = 0; i < expected.length; i++) {
    if (patchPath[i] !== expected[i]) return false;
  }
  return true;
}

function lookup<T>(doc: unknown, path: Prop[]): T | undefined {
  let current = doc as Record<string, unknown> | undefined;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key as string] as Record<string, unknown> | undefined;
  }
  return current as T | undefined;
}

class DeletionMarker extends WidgetType {
  readonly #deleted: string;

  constructor(deleted: string) {
    super();
    this.#deleted = deleted;
  }

  toDOM(): HTMLElement {
    const isDark =
      document.documentElement.classList.contains("dark") ||
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    const box = document.createElement("span");
    box.className = "cm-diff-deletion";
    box.textContent = "⌫";
    box.style.cssText = `
      display: inline-block;
      box-sizing: border-box;
      padding: 0 2px;
      margin: 0 4px;
      font-size: 0.8em;
      border-radius: 3px;
      cursor: default;
      color: ${isDark ? "rgb(248 113 113)" : "rgb(239 68 68)"};
      background-color: ${isDark ? "rgb(248 113 113 / 10%)" : "rgb(239 68 68 / 10%)"};
    `;

    if (this.#deleted) {
      const tooltip = document.createElement("span");
      tooltip.textContent = this.#deleted;
      tooltip.style.cssText = `
        position: absolute;
        z-index: 1;
        padding: 5px;
        font-size: 15px;
        border-radius: 3px;
        box-shadow: 0 0 6px rgba(0, 0, 0, 0.1);
        visibility: hidden;
        white-space: pre-wrap;
        background-color: ${isDark ? "rgb(69 10 10)" : "rgb(254 242 242)"};
        color: ${isDark ? "rgb(254 226 226)" : "rgb(17 24 39)"};
        border: 1px solid ${isDark ? "rgb(153 27 27)" : "rgb(185 28 28)"};
      `;
      box.appendChild(tooltip);
      box.onmouseover = () => {
        tooltip.style.visibility = "visible";
      };
      box.onmouseout = () => {
        tooltip.style.visibility = "hidden";
      };
    }

    return box;
  }

  eq(other: DeletionMarker): boolean {
    return other.#deleted === this.#deleted;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
