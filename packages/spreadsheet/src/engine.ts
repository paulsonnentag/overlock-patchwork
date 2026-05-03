import type { MatchResult } from "ohm-js";

import type {
  CellKey,
  CellState,
  Effect,
  Engine,
  EvalContext,
  EvalResult,
  Sheet,
  SpreadsheetLanguage,
} from "./types";
import { isCellKey } from "./coords";
import { isEffect } from "./effect";
import {
  type Graph,
  isNonTrivialSCC,
  tarjanSCC,
  topoSort,
  transitiveDependents,
} from "./graph";

type Listener = (changed: Set<CellKey>) => void;

type CellRecord<V> = {
  source: string;
  match: MatchResult;
  deps: CellKey[];
  state: CellState<V>;
  lastInputs: Map<CellKey, V>;
  cleanup: (() => void) | null;
  evalToken: number;
  dirty: boolean;
};

export function createEngine<V>(
  sheet: Sheet,
  lang: SpreadsheetLanguage<V>,
): Engine<V> {
  return new EngineImpl<V>(sheet, lang);
}

class EngineImpl<V> implements Engine<V> {
  readonly #lang: SpreadsheetLanguage<V>;
  readonly #cells = new Map<CellKey, CellRecord<V>>();
  readonly #forward: Graph = new Map();
  readonly #reverse: Graph = new Map();
  readonly #listeners = new Set<Listener>();
  #cycleSet = new Set<CellKey>();
  #sccByCell = new Map<CellKey, CellKey[]>();
  #destroyed = false;

  constructor(sheet: Sheet, lang: SpreadsheetLanguage<V>) {
    this.#lang = lang;
    for (const [k, src] of Object.entries(sheet)) {
      if (!isCellKey(k)) continue;
      this.#parseAndStore(k, src);
    }
    this.#runPass();
  }

  setCell(key: CellKey, source: string): void {
    this.#assertAlive();
    if (!isCellKey(key)) throw new Error(`invalid cell key: ${key}`);
    const existing = this.#cells.get(key);
    if (existing && existing.source === source) return;
    this.#parseAndStore(key, source);
    this.#runPass();
  }

  deleteCell(key: CellKey): void {
    this.#assertAlive();
    if (!isCellKey(key)) throw new Error(`invalid cell key: ${key}`);
    const existing = this.#cells.get(key);
    if (!existing || existing.source === "") return;
    this.#parseAndStore(key, "");
    this.#runPass();
  }

  get(key: CellKey): CellState<V> {
    const rec = this.#cells.get(key);
    if (rec) return rec.state;
    return { status: "ok", value: undefined as V };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const rec of this.#cells.values()) runCleanup(rec);
    this.#cells.clear();
    this.#forward.clear();
    this.#reverse.clear();
    this.#listeners.clear();
    this.#cycleSet.clear();
    this.#sccByCell.clear();
  }

  // Single re-evaluation pass: pick up everything currently marked
  // `dirty`, fill any newly-referenced absent cells, recompute the
  // graph + cycles, and walk the affected non-cycle cells in topo
  // order. Cycle membership flips are folded into the affected seed.
  #runPass(): void {
    if (this.#destroyed) return;
    this.#fillAbsent();
    this.#rebuildGraphs();

    const oldCycleSet = this.#cycleSet;
    const { cycleSet, sccByCell } = this.#detectCycles();
    this.#cycleSet = cycleSet;
    this.#sccByCell = sccByCell;

    const dirtyKeys: CellKey[] = [];
    for (const [k, rec] of this.#cells) if (rec.dirty) dirtyKeys.push(k);
    const cycleDelta = symmetricDifference(oldCycleSet, cycleSet);

    const affected = transitiveDependents(this.#reverse, [
      ...dirtyKeys,
      ...cycleDelta,
    ]);

    const changed = new Set<CellKey>();
    this.#applyCycleStates(affected, sccByCell, changed);

    const evalSet = new Set<CellKey>();
    for (const k of affected) if (!cycleSet.has(k)) evalSet.add(k);
    const order = topoSort(this.#forward, evalSet);
    for (const k of order) this.#evaluateCell(k, changed);

    if (changed.size > 0) this.#notify(changed);
  }

  #evaluateCell(key: CellKey, changed: Set<CellKey>): void {
    const rec = this.#cells.get(key);
    if (!rec) return;

    for (const dep of rec.deps) {
      const depRec = this.#cells.get(dep);
      if (depRec && depRec.state.status === "pending") {
        rec.lastInputs = new Map();
        this.#applyState(rec, key, { status: "pending" }, changed);
        return;
      }
    }

    if (!rec.dirty && rec.state.status === "ok") {
      let same = true;
      for (const dep of rec.deps) {
        if (!Object.is(rec.lastInputs.get(dep), readValue(this.#cells, dep))) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    runCleanup(rec);
    rec.evalToken++;
    rec.dirty = false;
    const myToken = rec.evalToken;

    const inputs = new Map<CellKey, V>();
    const ctx: EvalContext<V> = {
      get: (k) => {
        const v = readValue(this.#cells, k) as V;
        inputs.set(k, v);
        return v;
      },
    };

    const result: EvalResult<V> = this.#lang.evaluation(rec.match).eval(ctx);
    rec.lastInputs = inputs;

    if (isPromise(result)) {
      this.#applyState(rec, key, { status: "pending" }, changed);
      result.then(
        (resolved) => this.#onAsyncResolve(key, myToken, resolved),
        () => {
          /* language errors surface via uncaught rejection */
        },
      );
      return;
    }

    if (isEffect(result)) {
      rec.cleanup = result.cleanup;
      this.#applyState(
        rec,
        key,
        { status: "ok", value: result.value },
        changed,
      );
    } else {
      this.#applyState(
        rec,
        key,
        { status: "ok", value: result as V },
        changed,
      );
    }
  }

  // A previously-pending evaluation completed. Either commit it (and
  // cascade into dependents whose inputs may have changed) or, if a
  // newer evaluation has superseded this one, drop the value and run
  // any cleanup it carried.
  #onAsyncResolve(key: CellKey, myToken: number, resolved: V | Effect<V>): void {
    if (this.#destroyed) {
      if (isEffect<V>(resolved)) safeCleanup(resolved.cleanup);
      return;
    }
    const rec = this.#cells.get(key);
    if (!rec || rec.evalToken !== myToken) {
      if (isEffect<V>(resolved)) safeCleanup(resolved.cleanup);
      return;
    }

    const changed = new Set<CellKey>();
    if (isEffect<V>(resolved)) {
      rec.cleanup = resolved.cleanup;
      this.#applyState(
        rec,
        key,
        { status: "ok", value: resolved.value },
        changed,
      );
    } else {
      this.#applyState(rec, key, { status: "ok", value: resolved }, changed);
    }

    const downstream = transitiveDependents(this.#reverse, [key]);
    downstream.delete(key);
    const order = topoSort(this.#forward, downstream);
    for (const k of order) this.#evaluateCell(k, changed);

    if (changed.size > 0) this.#notify(changed);
  }

  #parseAndStore(key: CellKey, source: string): void {
    const match = this.#lang.grammar.match(source);
    if (match.failed()) {
      throw new Error(
        `language grammar must be total but failed on cell ${key}: ${match.message ?? "no message"}`,
      );
    }
    const deps: CellKey[] = this.#lang
      .dependencies(match)
      .deps()
      .filter(isCellKey);

    const existing = this.#cells.get(key);
    if (existing) {
      existing.source = source;
      existing.match = match;
      existing.deps = deps;
      existing.lastInputs = new Map();
      existing.dirty = true;
      existing.evalToken++;
    } else {
      this.#cells.set(key, {
        source,
        match,
        deps,
        state: { status: "pending" },
        lastInputs: new Map(),
        cleanup: null,
        evalToken: 0,
        dirty: true,
      });
    }
  }

  #fillAbsent(): void {
    const queue: CellKey[] = [];
    for (const rec of this.#cells.values()) {
      for (const dep of rec.deps) {
        if (!this.#cells.has(dep)) queue.push(dep);
      }
    }
    while (queue.length > 0) {
      const k = queue.shift()!;
      if (this.#cells.has(k)) continue;
      this.#parseAndStore(k, "");
      for (const dep of this.#cells.get(k)!.deps) {
        if (!this.#cells.has(dep)) queue.push(dep);
      }
    }
  }

  #rebuildGraphs(): void {
    this.#forward.clear();
    this.#reverse.clear();
    for (const k of this.#cells.keys()) {
      this.#forward.set(k, new Set());
      this.#reverse.set(k, new Set());
    }
    for (const [k, rec] of this.#cells) {
      const out = this.#forward.get(k)!;
      for (const dep of rec.deps) {
        out.add(dep);
        this.#reverse.get(dep)?.add(k);
      }
    }
  }

  // Mark every SCC member and every cell transitively downstream of
  // an SCC as `cycle`. The downstream cell adopts the SCC it
  // (transitively) reaches via deps.
  #detectCycles(): {
    cycleSet: Set<CellKey>;
    sccByCell: Map<CellKey, CellKey[]>;
  } {
    const cycleSet = new Set<CellKey>();
    const sccByCell = new Map<CellKey, CellKey[]>();
    const sccs = tarjanSCC(this.#forward);
    const seeds = new Set<CellKey>();
    for (const scc of sccs) {
      if (!isNonTrivialSCC(scc, this.#forward)) continue;
      for (const k of scc) {
        cycleSet.add(k);
        sccByCell.set(k, scc);
        seeds.add(k);
      }
    }
    for (const k of transitiveDependents(this.#reverse, seeds)) {
      if (cycleSet.has(k)) continue;
      cycleSet.add(k);
      sccByCell.set(k, this.#firstReachableSCC(k, sccByCell));
    }
    return { cycleSet, sccByCell };
  }

  #firstReachableSCC(
    from: CellKey,
    sccByCell: Map<CellKey, CellKey[]>,
  ): CellKey[] {
    const seen = new Set<CellKey>([from]);
    const queue: CellKey[] = [];
    for (const dep of this.#forward.get(from) ?? []) queue.push(dep);
    while (queue.length > 0) {
      const k = queue.shift()!;
      if (seen.has(k)) continue;
      seen.add(k);
      const scc = sccByCell.get(k);
      if (scc) return scc;
      for (const dep of this.#forward.get(k) ?? []) queue.push(dep);
    }
    return [from];
  }

  #applyCycleStates(
    affected: Set<CellKey>,
    sccByCell: Map<CellKey, CellKey[]>,
    changed: Set<CellKey>,
  ): void {
    for (const k of affected) {
      if (!this.#cycleSet.has(k)) continue;
      const rec = this.#cells.get(k);
      if (!rec) continue;
      const cycle = sccByCell.get(k) ?? [k];
      const next: CellState<V> = { status: "cycle", cycle: [...cycle] };
      if (stateEquals(rec.state, next)) continue;
      runCleanup(rec);
      rec.state = next;
      rec.lastInputs = new Map();
      changed.add(k);
    }
  }

  #applyState(
    rec: CellRecord<V>,
    key: CellKey,
    next: CellState<V>,
    changed: Set<CellKey>,
  ): void {
    if (stateEquals(rec.state, next)) return;
    rec.state = next;
    changed.add(key);
  }

  #notify(changed: Set<CellKey>): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(changed);
      } catch {
        /* listener errors are not the engine's problem */
      }
    }
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error("engine destroyed");
  }
}

function readValue<V>(cells: Map<CellKey, CellRecord<V>>, key: CellKey): V {
  const rec = cells.get(key);
  if (rec && rec.state.status === "ok") return rec.state.value;
  return undefined as V;
}

function runCleanup<V>(rec: CellRecord<V>): void {
  if (!rec.cleanup) return;
  const fn = rec.cleanup;
  rec.cleanup = null;
  safeCleanup(fn);
}

function safeCleanup(fn: () => void): void {
  try {
    fn();
  } catch {
    /* per spec: cleanups should not throw */
  }
}

function stateEquals<V>(a: CellState<V>, b: CellState<V>): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ok" && b.status === "ok") return Object.is(a.value, b.value);
  if (a.status === "cycle" && b.status === "cycle") {
    return arrayEquals(a.cycle, b.cycle);
  }
  return true;
}

function arrayEquals<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function symmetricDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const x of a) if (!b.has(x)) out.add(x);
  for (const x of b) if (!a.has(x)) out.add(x);
  return out;
}

function isPromise<T>(x: unknown): x is Promise<T> {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { then?: unknown }).then === "function"
  );
}
