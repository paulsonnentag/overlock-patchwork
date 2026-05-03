import type { CellKey } from "./types";

export type Graph = Map<CellKey, Set<CellKey>>;

export function tarjanSCC(graph: Graph): CellKey[][] {
  const indices = new Map<CellKey, number>();
  const lowlinks = new Map<CellKey, number>();
  const onStack = new Set<CellKey>();
  const stack: CellKey[] = [];
  const sccs: CellKey[][] = [];
  let nextIndex = 0;

  const strongconnect = (v: CellKey): void => {
    indices.set(v, nextIndex);
    lowlinks.set(v, nextIndex);
    nextIndex++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) ?? new Set<CellKey>()) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: CellKey[] = [];
      let w: CellKey;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const v of graph.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }
  return sccs;
}

export function isNonTrivialSCC(scc: CellKey[], graph: Graph): boolean {
  if (scc.length > 1) return true;
  const only = scc[0]!;
  return graph.get(only)?.has(only) ?? false;
}

export function topoSort(graph: Graph, nodes: Set<CellKey>): CellKey[] {
  const indegree = new Map<CellKey, number>();
  for (const n of nodes) indegree.set(n, 0);
  for (const n of nodes) {
    for (const dep of graph.get(n) ?? []) {
      if (nodes.has(dep)) indegree.set(dep, (indegree.get(dep) ?? 0) + 1);
    }
  }

  const queue: CellKey[] = [];
  for (const [n, d] of indegree) if (d === 0) queue.push(n);

  // Topological order: a cell evaluates *after* its deps. The graph
  // edge goes from cell -> dep, so "no dependents" (sinks in this
  // orientation) come first; we reverse below to get evaluation order.
  const reverseOrder: CellKey[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    reverseOrder.push(n);
    for (const dep of graph.get(n) ?? []) {
      if (!nodes.has(dep)) continue;
      const next = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, next);
      if (next === 0) queue.push(dep);
    }
  }

  return reverseOrder.reverse();
}

export function transitiveDependents(
  reverse: Graph,
  seed: Iterable<CellKey>,
): Set<CellKey> {
  const seen = new Set<CellKey>();
  const queue: CellKey[] = [];
  for (const s of seed) {
    if (!seen.has(s)) {
      seen.add(s);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const d of reverse.get(n) ?? []) {
      if (!seen.has(d)) {
        seen.add(d);
        queue.push(d);
      }
    }
  }
  return seen;
}
