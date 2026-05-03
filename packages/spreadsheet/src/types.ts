import type { Grammar, Semantics } from "ohm-js";

export type CellKey = string;
export type Sheet = Record<CellKey, string>;

export type EvalContext<V> = {
  get(key: CellKey): V;
};

export type Effect<V> = {
  value: V;
  cleanup: () => void;
};

export type EvalResult<V> = V | Effect<V> | Promise<V | Effect<V>>;

export type CellState<V> =
  | { status: "ok"; value: V }
  | { status: "pending" }
  | { status: "cycle"; cycle: CellKey[] };

export type SpreadsheetLanguage<V> = {
  grammar: Grammar;
  dependencies: Semantics;
  evaluation: Semantics;
  // Phantom marker so the type parameter participates in inference.
  readonly __value?: V;
};

export type Engine<V> = {
  setCell(key: CellKey, source: string): void;
  deleteCell(key: CellKey): void;
  get(key: CellKey): CellState<V>;
  subscribe(listener: (changed: Set<CellKey>) => void): () => void;
  destroy(): void;
};
