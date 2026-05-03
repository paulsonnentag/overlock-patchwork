import type { Coord } from "./coords";

export type Selection = { anchor: Coord; head: Coord };

export type Rect = { r0: number; r1: number; c0: number; c1: number };

export function rect(s: Selection): Rect {
  return {
    r0: Math.min(s.anchor.row, s.head.row),
    r1: Math.max(s.anchor.row, s.head.row),
    c0: Math.min(s.anchor.col, s.head.col),
    c1: Math.max(s.anchor.col, s.head.col),
  };
}

export function isInside(s: Selection, c: Coord): boolean {
  const r = rect(s);
  return c.row >= r.r0 && c.row <= r.r1 && c.col >= r.c0 && c.col <= r.c1;
}

export function collapseTo(c: Coord): Selection {
  return { anchor: c, head: c };
}

export function moveHead(s: Selection, c: Coord): Selection {
  return { anchor: s.anchor, head: c };
}

export function clamp(c: Coord, maxRow: number, maxCol: number): Coord {
  return {
    row: Math.max(0, Math.min(maxRow, c.row)),
    col: Math.max(0, Math.min(maxCol, c.col)),
  };
}
