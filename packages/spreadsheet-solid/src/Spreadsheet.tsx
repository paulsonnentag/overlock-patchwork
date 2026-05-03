import { createMemo, createSignal, onCleanup } from "solid-js";

import type { DocHandle } from "@automerge/automerge-repo";
import {
  createEngine,
  type CellState,
  type Sheet,
  type SpreadsheetLanguage,
} from "spreadsheet";

import { FormulaBar } from "./FormulaBar";
import { Grid } from "./grid/Grid";
import { fromKey, toKey, type Coord } from "./coords";
import { collapseTo, rect, type Selection } from "./selection";
import { parseTSV, pasteAt, rectToTSV, tsvBounds } from "./clipboard";
import { createEngineSignals } from "./engineSignal";
import { bindSheet } from "./sheetSync";

const ZERO: Coord = { row: 0, col: 0 };
const DEFAULT_COLS = 26;
const MIN_VISIBLE_ROWS = 50;
const ROW_BUFFER = 20;

export type SpreadsheetProps<V> = {
  handle: DocHandle<Sheet>;
  language: SpreadsheetLanguage<V>;
  format?: (state: CellState<V>) => string;
};

export function Spreadsheet<V>(props: SpreadsheetProps<V>) {
  const engine = createEngine<V>({}, props.language);
  onCleanup(() => engine.destroy());

  const sheet = bindSheet(props.handle, engine);
  const cellSignal = createEngineSignals(engine);
  const format = props.format ?? defaultFormat;

  const [sel, setSel] = createSignal<Selection>(collapseTo(ZERO));
  const [editing, setEditing] = createSignal<{ coord: Coord; initial?: string } | null>(
    null,
  );
  const [rows, setRows] = createSignal(initialRowsFor(sheet));
  const [cols, setCols] = createSignal(DEFAULT_COLS);

  const active = createMemo(() => sel().head);
  const activeKey = createMemo(() => toKey(active()));
  const activeSource = createMemo(() => sheet[activeKey()] ?? "");

  const sourceAt = (c: Coord): string => sheet[toKey(c)] ?? "";

  const writeCell = (key: string, src: string) => {
    props.handle.change((d: Sheet) => {
      if (src === "") delete d[key];
      else d[key] = src;
    });
  };

  const writeMany = (entries: Array<{ key: string; src: string }>) => {
    if (entries.length === 0) return;
    props.handle.change((d: Sheet) => {
      for (const { key, src } of entries) {
        if (src === "") delete d[key];
        else d[key] = src;
      }
    });
  };

  const startEdit = (coord: Coord, initial?: string) => {
    setEditing({ coord, initial });
  };

  const commitEdit = (src: string, dr: number, dc: number) => {
    const cur = editing();
    if (!cur) return;
    writeCell(toKey(cur.coord), src);
    setEditing(null);
    if (dr !== 0 || dc !== 0) {
      const next = {
        row: Math.max(0, cur.coord.row + dr),
        col: Math.max(0, cur.coord.col + dc),
      };
      setSel(collapseTo(next));
      if (next.row >= rows()) setRows(next.row + ROW_BUFFER);
      if (next.col >= cols()) setCols(next.col + 5);
    }
  };

  const cancelEdit = () => setEditing(null);

  const clearSelection = () => {
    const r = rect(sel());
    const entries: Array<{ key: string; src: string }> = [];
    for (let row = r.r0; row <= r.r1; row++) {
      for (let col = r.c0; col <= r.c1; col++) {
        entries.push({ key: toKey({ row, col }), src: "" });
      }
    }
    writeMany(entries);
  };

  const copySelection = (): string => rectToTSV(sheet, rect(sel()));

  const cutSelection = (): string => {
    const tsv = copySelection();
    clearSelection();
    return tsv;
  };

  const pasteAtCoord = (origin: Coord, tsv: string) => {
    const parsed = parseTSV(tsv);
    if (parsed.length === 0) return;
    const { writes } = pasteAt(origin, parsed);
    writeMany(writes);
    const { rows: dr, cols: dc } = tsvBounds(parsed);
    const end = {
      row: origin.row + Math.max(0, dr - 1),
      col: origin.col + Math.max(0, dc - 1),
    };
    setSel({ anchor: origin, head: end });
    if (end.row >= rows()) setRows(end.row + ROW_BUFFER);
    if (end.col >= cols()) setCols(end.col + 5);
  };

  const onCommitFromBar = (src: string) => writeCell(activeKey(), src);

  return (
    <div class="ss-root">
      <FormulaBar
        active={active}
        source={activeSource}
        onCommit={onCommitFromBar}
      />
      <Grid
        rows={rows}
        cols={cols}
        setRows={setRows}
        setCols={setCols}
        cellSignal={cellSignal}
        source={sourceAt}
        format={format}
        sel={sel}
        setSel={setSel}
        editing={editing}
        actions={{
          startEdit,
          commitEdit,
          cancelEdit,
          clearSelection,
          copySelection,
          cutSelection,
          pasteAt: pasteAtCoord,
        }}
      />
    </div>
  );
}

function initialRowsFor(sheet: Sheet): number {
  let max = 0;
  for (const k of Object.keys(sheet)) {
    try {
      const c = fromKey(k);
      if (c.row > max) max = c.row;
    } catch {
      /* skip non-A1 keys */
    }
  }
  return Math.max(MIN_VISIBLE_ROWS, max + ROW_BUFFER);
}

function defaultFormat<V>(s: CellState<V>): string {
  if (s.status === "pending") return "…";
  if (s.status === "cycle") return "#CYCLE!";
  const v = s.value;
  if (v == null || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "#NUM!";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
