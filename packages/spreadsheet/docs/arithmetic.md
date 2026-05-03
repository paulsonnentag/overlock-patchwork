# Arithmetic language

The bundled reference language — a tiny calculator with cell
references, addition, multiplication, and a string fallback. Source:
[`../src/languages/arithmetic.ts`](../src/languages/arithmetic.ts).

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

The grammar is total: every string matches `Formula`, `empty`, or
`text`, so no source can fail to parse.

```ts
const dependencies = grammar.createSemantics().addOperation('deps()', {
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

`empty` returns `0` so a referenced empty cell contributes neutrally
to sums and multiplies. `text` returns the raw source — useful for
labels alongside formulas. `ref` reads `this.sourceString`, which is
already uppercase per the `upper+ digit+` rule, so it lines up
directly with `CellKey`.
