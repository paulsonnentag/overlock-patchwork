import type { CellKey } from "spreadsheet";

export type Coord = { row: number; col: number };

export function toKey({ row, col }: Coord): CellKey {
  return colLetters(col) + (row + 1);
}

export function fromKey(k: CellKey): Coord {
  const m = /^([A-Z]+)([1-9]\d*)$/.exec(k);
  if (!m) throw new Error(`invalid cell key: ${k}`);
  let col = 0;
  for (const c of m[1]) col = col * 26 + (c.charCodeAt(0) - 64);
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

export function colLetters(col: number): string {
  let n = col;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function eqCoord(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}
