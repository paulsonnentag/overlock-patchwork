# Language plug-in

A language is an object the engine consumes; it bundles an Ohm grammar
with the two semantics the engine needs. Source:
[`../src/types.ts`](../src/types.ts), [`../src/effect.ts`](../src/effect.ts);
worked example in [`../src/languages/arithmetic.ts`](../src/languages/arithmetic.ts).

```ts
type SpreadsheetLanguage<V> = {
  grammar: ohm.Grammar;
  dependencies: ohm.Semantics;  // adds deps()
  evaluation: ohm.Semantics;    // adds eval(ctx)
};
```

The grammar's start rule matches a single cell's source and **must be
total** — every string (including `""`) must match. Languages
typically achieve this with a catch-all production that produces an
error value. The engine throws on a parse failure rather than treating
it as a runtime error, because totality is a language-level
contract.

The two semantics are separate on purpose: `deps` must be computable
without values (the engine needs them to schedule evaluation), and
`eval` must be computable without re-walking the dependency analysis.

## `deps` operation

Added to `language.dependencies` via `addOperation('deps()', …)`.
Returns `CellKey[]` — the cells this formula references, in any
order, deduplication not required (the engine dedupes). Static: must
not depend on cell values.

## `eval` operation

Added to `language.evaluation` via `addOperation('eval(ctx)', …)`.
The single argument `ctx` is the engine-supplied lookup:

```ts
type EvalContext<V> = {
  get(key: CellKey): V;
};
```

`ctx.get` always returns a `V`. Cells whose dependencies are in a
cycle are not evaluated, so a semantic action never sees a pending or
errored dependency through `ctx.get`.

The return shape:

```ts
type EvalResult<V> =
  | V
  | Effect<V>
  | Promise<V | Effect<V>>;

type Effect<V> = { value: V; cleanup: () => void };
```

A semantic action that performs a side effect (subscribes to a stream,
opens a handle, schedules a timer) returns `withCleanup(value, fn)`
from [`../src/effect.ts`](../src/effect.ts) so the engine can tear it
down. See [`engine.md`](./engine.md) for when cleanups run.
