import * as ohm from "ohm-js";

import type { CellKey, EvalContext, SpreadsheetLanguage } from "../types";

export type ArithmeticValue = number | string;

const grammar = ohm.grammar(String.raw`
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
`);

const dependencies = grammar
  .createSemantics()
  .addOperation<CellKey[]>("deps()", {
    Formula(_eq, exp) {
      return (exp as ohm.NonterminalNode).deps();
    },
    empty() {
      return [];
    },
    text(_chars) {
      return [];
    },
    AddExp_plus(a, _op, b) {
      return [...(a as ohm.NonterminalNode).deps(), ...(b as ohm.NonterminalNode).deps()];
    },
    MulExp_times(a, _op, b) {
      return [...(a as ohm.NonterminalNode).deps(), ...(b as ohm.NonterminalNode).deps()];
    },
    PriExp_paren(_l, e, _r) {
      return (e as ohm.NonterminalNode).deps();
    },
    ref(_letters, _digits) {
      return [this.sourceString];
    },
    number(_whole, _frac) {
      return [];
    },
    _nonterminal(...children) {
      if (children.length === 1) {
        return (children[0] as ohm.NonterminalNode).deps();
      }
      return [];
    },
  });

const evaluation = grammar
  .createSemantics()
  .addOperation<ArithmeticValue>("eval(ctx)", {
    Formula(_eq, exp) {
      return (exp as ohm.NonterminalNode).eval(this.args.ctx);
    },
    empty() {
      return 0;
    },
    text(_chars) {
      return this.sourceString;
    },
    AddExp_plus(a, _op, b) {
      const lhs = (a as ohm.NonterminalNode).eval(this.args.ctx);
      const rhs = (b as ohm.NonterminalNode).eval(this.args.ctx);
      return numericBinop(lhs, rhs, (x, y) => x + y);
    },
    MulExp_times(a, _op, b) {
      const lhs = (a as ohm.NonterminalNode).eval(this.args.ctx);
      const rhs = (b as ohm.NonterminalNode).eval(this.args.ctx);
      return numericBinop(lhs, rhs, (x, y) => x * y);
    },
    PriExp_paren(_l, e, _r) {
      return (e as ohm.NonterminalNode).eval(this.args.ctx);
    },
    ref(_letters, _digits) {
      const ctx = this.args.ctx as EvalContext<ArithmeticValue>;
      return ctx.get(this.sourceString);
    },
    number(_whole, _frac) {
      return parseFloat(this.sourceString);
    },
    _nonterminal(...children) {
      if (children.length === 1) {
        return (children[0] as ohm.NonterminalNode).eval(this.args.ctx);
      }
      return 0;
    },
  });

export const arithmetic: SpreadsheetLanguage<ArithmeticValue> = {
  grammar,
  dependencies,
  evaluation,
};

function numericBinop(
  lhs: ArithmeticValue,
  rhs: ArithmeticValue,
  op: (x: number, y: number) => number,
): ArithmeticValue {
  const x = typeof lhs === "number" ? lhs : parseFloat(lhs);
  const y = typeof rhs === "number" ? rhs : parseFloat(rhs);
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  return op(x, y);
}
