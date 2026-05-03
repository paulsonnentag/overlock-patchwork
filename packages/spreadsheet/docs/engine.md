# Engine

The engine is stateful, holds the sheet, and incrementally
re-evaluates as cells change. Source: [`../src/engine.ts`](../src/engine.ts),
graph helpers in [`../src/graph.ts`](../src/graph.ts).

```ts
type Engine<V> = {
  setCell(key: CellKey, source: string): void;
  deleteCell(key: CellKey): void;
  get(key: CellKey): CellState<V>;
  subscribe(listener: (changed: Set<CellKey>) => void): () => void;
  destroy(): void;
};

type CellState<V> =
  | { status: 'ok'; value: V }
  | { status: 'pending' }
  | { status: 'cycle'; cycle: CellKey[] };

declare function createEngine<V>(
  sheet: Sheet,
  lang: SpreadsheetLanguage<V>,
): Engine<V>;
```

`get` is defined for every key referenced by any cell, including keys
that were referenced but never written (their state is derived from
matching `""` against the language). For unrelated keys it returns
the empty-cell state too.

## Initial pass

On `createEngine`:

1. Parse every cell in `sheet` via `lang.grammar.match(src)` and
   cache the `MatchResult` per `CellKey`. Throw on `match.failed()`.
2. Compute `deps` for each match via `lang.dependencies(match).deps()`
   to build `CellKey → CellKey[]`. Newly referenced absent keys are
   added to the universe; their source is `""`.
3. Detect cycles. Run Tarjan's SCC over the graph. Every cell in a
   non-trivial SCC, plus every cell transitively depending on one, is
   marked `{ status: 'cycle', cycle }` and never evaluated.
4. Topologically sort the remaining cells.
5. Walk in topo order. Build an `EvalContext` whose `get` reads from
   the value map, then call `lang.evaluation(match).eval(ctx)`. If the
   result is a promise, the cell is `pending` until it resolves;
   dependents wait.

## Re-evaluation

`setCell(k, src)` and `deleteCell(k)` mark `k` dirty and trigger a
pass:

1. Re-parse `k`. Match the new source; recompute `deps(k)`. Update
   the forward and reverse graphs.
2. Compute the affected set: `k` plus the transitive dependents of
   `k`'s old and new dep sets in the graph.
3. Re-detect cycles within the affected subgraph (cycles can appear
   or disappear when deps change).
4. Re-evaluate the affected set in topo order. A cell is re-evaluated
   when its source changed *or* any of its deps' values changed. The
   engine compares per-dep `V` with `Object.is`; languages with
   structural values can wrap in their own equality if needed (out of
   scope here).
5. Run cleanups for every superseded evaluation before its replacement
   runs.
6. Notify subscribers with the set of keys whose `CellState` changed.

## Async

`eval` may return `Promise<V | Effect<V>>`. While the promise is
unresolved the cell's `CellState` is `{ status: 'pending' }` and
dependents that haven't been evaluated yet wait — their evaluation
is deferred until the promise resolves. A subsequent `setCell` that
supersedes this evaluation cancels it: when the promise eventually
resolves, its result is dropped and any `Effect.cleanup` it carries
is called immediately.

The engine does **not** expose cancellation tokens to `eval`. If a
language needs cooperative cancellation, it can plumb its own
`AbortSignal` through `EvalContext` (extension point, not in this
minimal interface).

## Cleanup

Every successful evaluation that returned an `Effect<V>` has its
`cleanup` registered against the cell. Cleanup runs when:

- the cell is re-evaluated (before the new evaluation starts),
- the cell is deleted,
- the engine is destroyed,
- a pending async evaluation is superseded and later resolves.

Cleanups run synchronously in unspecified order; they should not
throw. The engine calls each cleanup at most once.
