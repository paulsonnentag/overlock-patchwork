# Spreadsheet with Swappable Semantics

A minimal sketch of a spreadsheet whose formula language is defined
by an [Ohm](https://ohmjs.org/) grammar and a pair of semantics
(dependencies + evaluation). The evaluation engine is generic — it
knows nothing about the formula language; it only knows how to ask
the semantics two questions:

1. *What other cells does this cell read?*
2. *Given values for those cells, what is this cell's value?*

Swap the grammar + semantics, get a different spreadsheet language.

## Data model

A sheet is a flat map keyed by coordinate. This shape is chosen so
that two concurrent edits to different cells merge cleanly under a
last-writer-wins map (e.g. an Automerge `Map<string, string>`).

```ts
type CellKey = string;                // "A1", "B2", "AA10", …
type Sheet   = Record<CellKey, string>;
```

- Coordinates use the classical spreadsheet convention: one or more
  uppercase letters for the column followed by a 1-indexed row
  number. `A1` is the top-left cell. Columns extend `A…Z, AA…ZZ,
  AAA…`. Format: `^[A-Z]+[1-9][0-9]*$`.
- The cell's value is **always a string** — the raw source the user
  typed. All structure (numbers, references, formulas, errors,
  emptiness) is imposed by the grammar, not by the data model.
- An absent key is treated identically to the empty string. The
  grammar decides what `""` means.

That's the entire persisted state. Everything else (parse trees,
dependency graphs, computed values, effect cleanups) is derived and
lives in the engine.

## Language plug-in

A language is an object the engine consumes. It bundles a grammar
with the two semantics the engine needs.

```ts
interface SpreadsheetLanguage<V> {
  /**
   * Ohm grammar. Start rule matches a single cell's source.
   * MUST be total: every string (including "") matches. Languages
   * typically achieve this with a catch-all production that
   * produces an error value.
   */
  grammar: ohm.Grammar;

  /** Static dependency analysis. Adds `deps(): CellKey[]`. */
  dependencies: ohm.Semantics;

  /** Evaluation. Adds `eval(ctx): EvalResult<V>`. */
  evaluation: ohm.Semantics;
}
```

The two semantics are separate on purpose: dependencies must be
computable without values (the engine needs them to schedule
evaluation), and evaluation must be computable without re-walking
the dependency analysis.

### `deps` operation

Added to `language.dependencies` via `addOperation('deps()', …)`.
Returns `CellKey[]` — the cells this formula references, in any
order, deduplication not required (the engine dedupes). Static: must
not depend on cell values.

### `eval` operation

Added to `language.evaluation` via `addOperation('eval(ctx)', …)`.
The single argument `ctx` is the engine-supplied lookup:

```ts
interface EvalContext<V> {
  /** Resolved value of a dependency. */
  get(key: CellKey): V;
}
```

`ctx.get` always returns a `V`. Cells whose dependencies are in a
cycle are not evaluated, so a semantic action never sees a pending
or errored dependency through `ctx.get`.

The return shape is:

```ts
type EvalResult<V> =
  | V
  | Effect<V>
  | Promise<V | Effect<V>>;

interface Effect<V> {
  value: V;
  /** Called when this evaluation is superseded or torn down. */
  cleanup: () => void;
}

/** Helper for languages. */
declare function withCleanup<V>(value: V, cleanup: () => void): Effect<V>;
```

A semantic action that performs a side effect (subscribes to a
stream, opens a handle, schedules a timer) returns `withCleanup` so
the engine can tear it down. See *Cleanup* below.

## Engine

The engine is stateful, holds the sheet, and incrementally
re-evaluates as cells change.

```ts
interface Engine<V> {
  setCell(key: CellKey, source: string): void;
  deleteCell(key: CellKey): void;

  /** Current state of a cell. Defined for every key referenced by any cell. */
  get(key: CellKey): CellState<V>;

  /** Notified after each re-evaluation pass, with the keys whose state changed. */
  subscribe(listener: (changed: Set<CellKey>) => void): () => void;

  /** Tear everything down. Calls every active cleanup. */
  destroy(): void;
}

type CellState<V> =
  | { status: 'ok'; value: V }
  | { status: 'pending' }
  | { status: 'cycle'; cycle: CellKey[] };

declare function createEngine<V>(
  sheet: Sheet,
  lang: SpreadsheetLanguage<V>,
): Engine<V>;
```

### Initial pass

On `createEngine`:

1. **Parse.** For each non-empty cell, run `lang.grammar.match(src)`
   and cache the `MatchResult` keyed by `CellKey`.
2. **Collect deps.** For each match, run
   `lang.dependencies(match).deps()` to build
   `CellKey → CellKey[]`.
3. **Detect cycles.** Run Tarjan's SCC over the graph. Every cell in
   a non-trivial SCC, plus every cell transitively depending on
   one, is marked `{ status: 'cycle', cycle }` and never evaluated.
4. **Schedule.** Topologically sort the remaining cells.
5. **Evaluate.** Walk in topo order. Build an `EvalContext` whose
   `get` reads from the value map, then call
   `lang.evaluation(match).eval(ctx)`. If the result is a promise,
   the cell is `pending` until it resolves; dependents wait.

### Re-evaluation

`setCell(k, src)` and `deleteCell(k)` mark `k` dirty and trigger a
pass:

1. **Re-parse `k`.** Match the new source; recompute `deps(k)`.
2. **Compute affected set.** `k` plus the transitive dependents of
   `k`'s old and new dep sets in the graph.
3. **Re-detect cycles** within the affected subgraph (cycles can
   appear or disappear when deps change).
4. **Re-evaluate the affected set in topo order.** A cell is
   re-evaluated when its source changed *or* any of its deps'
   values changed. Cells whose `eval` would produce the same
   inputs are reused (engine compares by `Object.is` over each
   dep's `V`; languages with structural values can wrap in their
   own equality if needed — out of scope here).
5. **Run cleanups** for every superseded evaluation (see below).
6. **Notify subscribers** with the set of keys whose `CellState`
   changed.

### Async

`eval` may return `Promise<V | Effect<V>>`. While the promise is
unresolved:

- The cell's `CellState` is `{ status: 'pending' }`.
- Dependents that haven't been evaluated yet wait — their
  evaluation is deferred until the promise resolves.
- A subsequent `setCell` that supersedes this evaluation cancels
  it: when the promise eventually resolves, its result is dropped
  and any `Effect.cleanup` it carries is called immediately.

The engine does **not** expose cancellation tokens to `eval`. If a
language needs cooperative cancellation, it can plumb its own
`AbortSignal` through `EvalContext` (extension point, not in this
minimal interface).

### Cleanup

Every successful evaluation that returned an `Effect<V>` has its
`cleanup` registered against the cell. Cleanup runs when:

- the cell is re-evaluated (before the new evaluation starts),
- the cell is deleted,
- the engine is destroyed,
- a pending async evaluation is superseded and later resolves.

Cleanups run synchronously in unspecified order; they should not
throw. The engine calls each cleanup at most once.

## Example: a tiny arithmetic language

Sketch only — illustrates the shape, not a full language.

```ohm
Cell {
  Cell    = Formula | empty | text
  Formula = "=" Exp
  empty   = ""
  text    = (~"=" any)+
  Exp     = AddExp
  AddExp  = AddExp "+" MulExp  -- plus
          | MulExp
  MulExp  = MulExp "*" PriExp  -- times
          | PriExp
  PriExp  = "(" Exp ")"        -- paren
          | ref
          | number
  ref     = upper+ digit+
  number  = digit+ ("." digit+)?
}
```

```ts
const dependencies = grammar.createSemantics().addOperation('deps()', {
  Cell(c)                  { return c.deps(); },
  Formula(_eq, exp)        { return exp.deps(); },
  empty()                  { return []; },
  text(_)                  { return []; },
  AddExp_plus(a, _op, b)   { return [...a.deps(), ...b.deps()]; },
  MulExp_times(a, _op, b)  { return [...a.deps(), ...b.deps()]; },
  PriExp_paren(_l, e, _r)  { return e.deps(); },
  ref(_c, _r)              { return [this.sourceString]; },
  number(_w, _f)           { return []; },
  _nonterminal: (...c) => c.length === 1 ? c[0].deps() : [],
});

const evaluation = grammar.createSemantics().addOperation('eval(ctx)', {
  Cell(c)                  { return c.eval(this.args.ctx); },
  Formula(_eq, exp)        { return exp.eval(this.args.ctx); },
  empty()                  { return 0; },
  text(_)                  { return this.sourceString; },
  AddExp_plus(a, _, b)     { return a.eval(this.args.ctx) + b.eval(this.args.ctx); },
  MulExp_times(a, _, b)    { return a.eval(this.args.ctx) * b.eval(this.args.ctx); },
  PriExp_paren(_l, e, _r)  { return e.eval(this.args.ctx); },
  ref(_c, _r)              { return this.args.ctx.get(this.sourceString); },
  number(_w, _f)           { return parseFloat(this.sourceString); },
  _nonterminal(...c)       { return c.length === 1 ? c[0].eval(this.args.ctx) : 0; },
});
```

The grammar is total: every string matches `Formula`, `empty`, or
`text`, so no source can fail to parse.

## Boundaries

Things explicitly **not** in this spec, to keep the interface
minimal:

- Display formatting (the engine returns `V`; rendering is upstream).
- Editing UI, selection, undo, ranges (`A1:B3`).
- Cross-sheet references or named ranges.
- Cooperative cancellation of async `eval` (languages can layer it
  on via their own `EvalContext` extensions).
- Structural equality on `V` for change-tracking — the engine uses
  `Object.is`.
