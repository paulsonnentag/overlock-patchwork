# Spreadsheet engine

A generic engine that evaluates a sheet of strings against a swappable
formula language. The engine knows nothing about formulas — it only
asks the language two questions: what cells does this one read, and
given those values, what is its result. Source lives in
[`../src/`](../src).

Each page below is a short pointer into the relevant source files.
Read the source for the full picture; these pages just orient you.

- [`data-model.md`](./data-model.md) — `Sheet`, `CellKey`, the
  empty-cell rule.
- [`language.md`](./language.md) — `SpreadsheetLanguage<V>`, the
  `deps` and `eval` semantics, `EvalContext`, `Effect`, `withCleanup`.
- [`engine.md`](./engine.md) — `createEngine`, `Engine<V>`,
  `CellState<V>`, the initial pass and incremental re-evaluation,
  async, cleanup.
- [`arithmetic.md`](./arithmetic.md) — the bundled reference language.
- [`ui.md`](./ui.md) — Solid view bound to an Automerge `Sheet`:
  virtualization, selection, editing, clipboard, engine bridges.

## File map

- [`src/types.ts`](../src/types.ts) — `CellKey`, `Sheet`, `CellState`,
  `EvalContext`, `Effect`, `EvalResult`, `SpreadsheetLanguage`,
  `Engine`.
- [`src/coords.ts`](../src/coords.ts) — `isCellKey` validator.
- [`src/effect.ts`](../src/effect.ts) — `withCleanup`, `isEffect`.
- [`src/graph.ts`](../src/graph.ts) — Tarjan SCC, topological sort,
  transitive-dependents walk.
- [`src/engine.ts`](../src/engine.ts) — `createEngine` and the
  per-cell scheduling/evaluation loop.
- [`src/languages/arithmetic.ts`](../src/languages/arithmetic.ts) —
  the bundled reference language (grammar + semantics).
- [`src/index.ts`](../src/index.ts) — public barrel.

## Boundaries

Things explicitly **not** in scope, to keep the interface minimal:

- Display formatting — the engine returns `V`; rendering is upstream.
- Editing UI, selection, undo, ranges (`A1:B3`).
- Cross-sheet references or named ranges.
- Cooperative cancellation of async `eval` — languages can layer it
  on via their own `EvalContext` extensions.
- Structural equality on `V` for change-tracking — the engine uses
  `Object.is`.
