import type { CellKey } from "./types";

const CELL_KEY = /^[A-Z]+[1-9][0-9]*$/;

export function isCellKey(s: string): s is CellKey {
  return CELL_KEY.test(s);
}
