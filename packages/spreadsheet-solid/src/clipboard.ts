import type { Sheet } from "spreadsheet";

import { toKey, type Coord } from "./coords";
import type { Rect } from "./selection";

export function rectToTSV(sheet: Sheet, r: Rect): string {
  const rows: string[] = [];
  for (let row = r.r0; row <= r.r1; row++) {
    const cells: string[] = [];
    for (let col = r.c0; col <= r.c1; col++) {
      cells.push(sheet[toKey({ row, col })] ?? "");
    }
    rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

export type ParsedTSV = string[][];

export function parseTSV(tsv: string): ParsedTSV {
  return tsv
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

export function tsvBounds(tsv: ParsedTSV): { rows: number; cols: number } {
  return {
    rows: tsv.length,
    cols: tsv.reduce((m, row) => Math.max(m, row.length), 0),
  };
}

export function pasteAt(
  origin: Coord,
  tsv: ParsedTSV,
): { writes: Array<{ key: string; src: string }> } {
  const writes: Array<{ key: string; src: string }> = [];
  for (let dr = 0; dr < tsv.length; dr++) {
    const line = tsv[dr];
    for (let dc = 0; dc < line.length; dc++) {
      writes.push({
        key: toKey({ row: origin.row + dr, col: origin.col + dc }),
        src: line[dc],
      });
    }
  }
  return { writes };
}
