import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js";

import type { CellKey, CellState } from "spreadsheet";

import { Cell } from "./Cell";
import {
  colLetters,
  eqCoord,
  fromKey,
  toKey,
  type Coord,
} from "../coords";
import {
  clamp,
  collapseTo,
  isInside,
  moveHead,
  rect,
  type Selection,
} from "../selection";

export const ROW_H = 24;
export const COL_W = 100;
export const HEADER_H = 22;
export const ROW_HEADER_W = 40;
const OVERSCAN = 4;
const SCROLL_THRESHOLD = 200;
const DRAG_EDGE = 28;
const DRAG_SPEED = 12;

export type GridActions = {
  startEdit: (coord: Coord, initial?: string) => void;
  commitEdit: (src: string, dr: number, dc: number) => void;
  cancelEdit: () => void;
  clearSelection: () => void;
  copySelection: () => string;
  cutSelection: () => string;
  pasteAt: (origin: Coord, tsv: string) => void;
};

type GridProps<V> = {
  rows: Accessor<number>;
  cols: Accessor<number>;
  setRows: (n: number) => void;
  setCols: (n: number) => void;
  cellSignal: (key: CellKey) => Accessor<CellState<V>>;
  source: (coord: Coord) => string;
  format: (s: CellState<V>) => string;
  sel: Accessor<Selection>;
  setSel: (s: Selection) => void;
  editing: Accessor<{ coord: Coord; initial?: string } | null>;
  actions: GridActions;
  rootRef?: (el: HTMLDivElement) => void;
};

export function Grid<V>(props: GridProps<V>) {
  let scrollerRef!: HTMLDivElement;
  let rootRef!: HTMLDivElement;

  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [vw, setVw] = createSignal(0);
  const [vh, setVh] = createSignal(0);

  const visible = createMemo(() => {
    const top = scrollTop();
    const left = scrollLeft();
    const innerH = Math.max(0, vh() - HEADER_H);
    const innerW = Math.max(0, vw() - ROW_HEADER_W);
    const r0 = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const r1 = Math.min(
      props.rows() - 1,
      Math.ceil((top + innerH) / ROW_H) + OVERSCAN,
    );
    const c0 = Math.max(0, Math.floor(left / COL_W) - OVERSCAN);
    const c1 = Math.min(
      props.cols() - 1,
      Math.ceil((left + innerW) / COL_W) + OVERSCAN,
    );
    return { r0, r1, c0, c1 };
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      setVw(scrollerRef.clientWidth);
      setVh(scrollerRef.clientHeight);
    });
    ro.observe(scrollerRef);
    setVw(scrollerRef.clientWidth);
    setVh(scrollerRef.clientHeight);
    onCleanup(() => ro.disconnect());
    rootRef.focus();
  });

  const onScroll = () => {
    setScrollTop(scrollerRef.scrollTop);
    setScrollLeft(scrollerRef.scrollLeft);
    if (
      scrollerRef.scrollTop + scrollerRef.clientHeight >
      props.rows() * ROW_H - SCROLL_THRESHOLD
    ) {
      props.setRows(props.rows() + 50);
    }
    if (
      scrollerRef.scrollLeft + scrollerRef.clientWidth >
      props.cols() * COL_W - SCROLL_THRESHOLD
    ) {
      props.setCols(props.cols() + 10);
    }
  };

  const cellAtClient = (clientX: number, clientY: number): Coord | null => {
    const r = scrollerRef.getBoundingClientRect();
    const x = clientX - r.left + scrollerRef.scrollLeft - ROW_HEADER_W;
    const y = clientY - r.top + scrollerRef.scrollTop - HEADER_H;
    if (x < 0 || y < 0) return null;
    return clamp(
      { row: Math.floor(y / ROW_H), col: Math.floor(x / COL_W) },
      props.rows() - 1,
      props.cols() - 1,
    );
  };

  let dragging = false;
  let dragRaf = 0;
  let lastClient: { x: number; y: number } | null = null;

  const stopDragScroll = () => {
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = 0;
    }
  };

  const tickDragScroll = () => {
    dragRaf = 0;
    if (!dragging || !lastClient) return;
    const r = scrollerRef.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (lastClient.x < r.left + DRAG_EDGE) dx = -DRAG_SPEED;
    else if (lastClient.x > r.right - DRAG_EDGE) dx = DRAG_SPEED;
    if (lastClient.y < r.top + DRAG_EDGE) dy = -DRAG_SPEED;
    else if (lastClient.y > r.bottom - DRAG_EDGE) dy = DRAG_SPEED;
    if (dx !== 0 || dy !== 0) {
      scrollerRef.scrollBy({ left: dx, top: dy });
      const c = cellAtClient(lastClient.x, lastClient.y);
      if (c) props.setSel(moveHead(props.sel(), c));
      dragRaf = requestAnimationFrame(tickDragScroll);
    }
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const c = cellAtClient(e.clientX, e.clientY);
    if (!c) return;
    if (props.editing()) props.actions.cancelEdit();
    if (e.shiftKey) props.setSel(moveHead(props.sel(), c));
    else props.setSel(collapseTo(c));
    dragging = true;
    lastClient = { x: e.clientX, y: e.clientY };

    const onMove = (ev: MouseEvent) => {
      if (!dragging) return;
      lastClient = { x: ev.clientX, y: ev.clientY };
      const next = cellAtClient(ev.clientX, ev.clientY);
      if (next) props.setSel(moveHead(props.sel(), next));
      if (!dragRaf) dragRaf = requestAnimationFrame(tickDragScroll);
    };
    const onUp = () => {
      dragging = false;
      lastClient = null;
      stopDragScroll();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      rootRef.focus();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const ensureVisible = (c: Coord) => {
    const left = c.col * COL_W;
    const right = left + COL_W;
    const top = c.row * ROW_H;
    const bottom = top + ROW_H;
    const innerH = Math.max(0, scrollerRef.clientHeight - HEADER_H);
    const innerW = Math.max(0, scrollerRef.clientWidth - ROW_HEADER_W);
    if (left < scrollerRef.scrollLeft) scrollerRef.scrollLeft = left;
    else if (right > scrollerRef.scrollLeft + innerW)
      scrollerRef.scrollLeft = right - innerW;
    if (top < scrollerRef.scrollTop) scrollerRef.scrollTop = top;
    else if (bottom > scrollerRef.scrollTop + innerH)
      scrollerRef.scrollTop = bottom - innerH;
  };

  const moveActive = (dr: number, dc: number, shift: boolean) => {
    const cur = props.sel().head;
    const next = clamp(
      { row: cur.row + dr, col: cur.col + dc },
      Math.max(0, props.rows() - 1),
      Math.max(0, props.cols() - 1),
    );
    if (eqCoord(next, cur)) return;
    if (shift) props.setSel(moveHead(props.sel(), next));
    else props.setSel(collapseTo(next));
    ensureVisible(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (props.editing()) return; // inline editor handles its own keys
    const head = props.sel().head;
    const ctrl = e.metaKey || e.ctrlKey;
    if (ctrl) return; // copy/cut/paste handled via clipboard events
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1, 0, e.shiftKey);
        return;
      case "ArrowDown":
        e.preventDefault();
        moveActive(1, 0, e.shiftKey);
        return;
      case "ArrowLeft":
        e.preventDefault();
        moveActive(0, -1, e.shiftKey);
        return;
      case "ArrowRight":
        e.preventDefault();
        moveActive(0, 1, e.shiftKey);
        return;
      case "Tab":
        e.preventDefault();
        moveActive(0, e.shiftKey ? -1 : 1, false);
        return;
      case "Enter":
      case "F2":
        e.preventDefault();
        props.actions.startEdit(head);
        return;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        props.actions.clearSelection();
        return;
      case "Escape":
        e.preventDefault();
        props.setSel(collapseTo(head));
        return;
    }
    if (isPrintable(e)) {
      e.preventDefault();
      props.actions.startEdit(head, e.key);
    }
  };

  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData || props.editing()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", props.actions.copySelection());
  };

  const onCut = (e: ClipboardEvent) => {
    if (!e.clipboardData || props.editing()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", props.actions.cutSelection());
  };

  const onPaste = (e: ClipboardEvent) => {
    if (!e.clipboardData || props.editing()) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    props.actions.pasteAt(props.sel().head, text);
  };

  return (
    <div
      ref={(el) => {
        rootRef = el;
        props.rootRef?.(el);
      }}
      class="ss-grid-root"
      tabindex="0"
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
    >
      <div
        ref={scrollerRef}
        class="ss-scroller"
        onScroll={onScroll}
        onMouseDown={onMouseDown}
      >
        <div
          class="ss-spacer"
          style={{
            width: `${ROW_HEADER_W + props.cols() * COL_W}px`,
            height: `${HEADER_H + props.rows() * ROW_H}px`,
          }}
        >
          <ColHeaders
            c0={visible().c0}
            c1={visible().c1}
            sel={props.sel()}
          />
          <RowHeaders
            r0={visible().r0}
            r1={visible().r1}
            sel={props.sel()}
          />
          <Corner />
          <div
            class="ss-body"
            style={{
              left: `${ROW_HEADER_W}px`,
              top: `${HEADER_H}px`,
              width: `${props.cols() * COL_W}px`,
              height: `${props.rows() * ROW_H}px`,
            }}
          >
            <For each={visibleKeys(visible())}>
              {(key) => {
                const c = fromKey(key);
                return (
                  <Cell
                    row={c.row}
                    col={c.col}
                    rowH={ROW_H}
                    colW={COL_W}
                    state={props.cellSignal(key)}
                    format={props.format}
                    selected={isInside(props.sel(), c)}
                    active={eqCoord(props.sel().head, c)}
                  />
                );
              }}
            </For>
            <Show when={props.editing()}>
              {(editing) => (
                <InlineEditor
                  coord={editing().coord}
                  initial={editing().initial ?? props.source(editing().coord)}
                  onCommit={(src, dr, dc) => {
                    props.actions.commitEdit(src, dr, dc);
                    rootRef.focus();
                  }}
                  onCancel={() => {
                    props.actions.cancelEdit();
                    rootRef.focus();
                  }}
                />
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

function visibleKeys(v: { r0: number; r1: number; c0: number; c1: number }): string[] {
  const out: string[] = [];
  for (let row = v.r0; row <= v.r1; row++) {
    for (let col = v.c0; col <= v.c1; col++) out.push(toKey({ row, col }));
  }
  return out;
}

function ColHeaders(props: { c0: number; c1: number; sel: Selection }) {
  const r = () => rect(props.sel);
  const cols = () => {
    const out: number[] = [];
    for (let c = props.c0; c <= props.c1; c++) out.push(c);
    return out;
  };
  return (
    <div
      class="ss-col-headers"
      style={{
        left: `${ROW_HEADER_W}px`,
        height: `${HEADER_H}px`,
        width: `${(props.c1 - props.c0 + 1) * COL_W}px`,
        transform: `translateX(${props.c0 * COL_W}px)`,
      }}
    >
      <For each={cols()}>
        {(col) => {
          const offset = col - props.c0;
          return (
            <div
              class="ss-col-header"
              classList={{
                "ss-header-active": col >= r().c0 && col <= r().c1,
              }}
              style={{
                left: `${offset * COL_W}px`,
                width: `${COL_W}px`,
                height: `${HEADER_H}px`,
              }}
            >
              {colLetters(col)}
            </div>
          );
        }}
      </For>
    </div>
  );
}

function RowHeaders(props: { r0: number; r1: number; sel: Selection }) {
  const r = () => rect(props.sel);
  const rows = () => {
    const out: number[] = [];
    for (let i = props.r0; i <= props.r1; i++) out.push(i);
    return out;
  };
  return (
    <div
      class="ss-row-headers"
      style={{
        top: `${HEADER_H}px`,
        width: `${ROW_HEADER_W}px`,
        height: `${(props.r1 - props.r0 + 1) * ROW_H}px`,
        transform: `translateY(${props.r0 * ROW_H}px)`,
      }}
    >
      <For each={rows()}>
        {(row) => {
          const offset = row - props.r0;
          return (
            <div
              class="ss-row-header"
              classList={{
                "ss-header-active": row >= r().r0 && row <= r().r1,
              }}
              style={{
                top: `${offset * ROW_H}px`,
                height: `${ROW_H}px`,
                width: `${ROW_HEADER_W}px`,
              }}
            >
              {row + 1}
            </div>
          );
        }}
      </For>
    </div>
  );
}

function Corner() {
  return (
    <div
      class="ss-corner"
      style={{ width: `${ROW_HEADER_W}px`, height: `${HEADER_H}px` }}
    />
  );
}

function InlineEditor(props: {
  coord: Coord;
  initial: string;
  onCommit: (src: string, dr: number, dc: number) => void;
  onCancel: () => void;
}) {
  let inputRef!: HTMLInputElement;
  onMount(() => {
    inputRef.focus();
    const len = inputRef.value.length;
    inputRef.setSelectionRange(len, len);
  });
  return (
    <input
      ref={inputRef}
      class="ss-inline-editor"
      type="text"
      spellcheck={false}
      autocomplete="off"
      value={props.initial}
      style={{
        left: `${props.coord.col * COL_W}px`,
        top: `${props.coord.row * ROW_H}px`,
        width: `${COL_W}px`,
        height: `${ROW_H}px`,
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          props.onCommit(inputRef.value, e.shiftKey ? -1 : 1, 0);
        } else if (e.key === "Tab") {
          e.preventDefault();
          props.onCommit(inputRef.value, 0, e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
    />
  );
}

function isPrintable(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.length === 1;
}
