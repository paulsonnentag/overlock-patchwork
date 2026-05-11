import { useEffect, useMemo, useState } from "react";

import type { DocHandle } from "@automerge/automerge-repo";

import type { MergecraftDoc } from "./datatype";

export type Coord = [number, number, number];
export type CubeDiff = { added: Set<string>; deleted: Coord[] };

const EMPTY: CubeDiff = { added: new Set(), deleted: [] };

export const coordKey = ([x, y, z]: Coord): string => `${x}:${y}:${z}`;

// `BranchedDocHandle.forkSnapshot()` lives in the `branches` package;
// we duck-type it here to avoid a dep from mergecraft → branches.
type WithForkSnapshot<T> = {
  forkSnapshot?: () => DocHandle<T> | null;
};

export function useCubeDiff(handle: DocHandle<MergecraftDoc>): CubeDiff {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    handle.on("change", bump);
    handle.on("heads-changed", bump);
    return () => {
      handle.off("change", bump);
      handle.off("heads-changed", bump);
    };
  }, [handle]);

  return useMemo(() => {
    void version;
    const snapshot = (
      handle as unknown as WithForkSnapshot<MergecraftDoc>
    ).forkSnapshot?.();
    if (!snapshot) return EMPTY;

    const base = snapshot.doc()?.cubes ?? [];
    const branch = handle.doc()?.cubes ?? [];

    const baseSet = new Set(base.map(coordKey));
    const branchSet = new Set(branch.map(coordKey));

    const added = new Set<string>();
    for (const c of branch) {
      const k = coordKey(c);
      if (!baseSet.has(k)) added.add(k);
    }
    const deleted: Coord[] = [];
    for (const c of base) {
      if (!branchSet.has(coordKey(c))) deleted.push(c);
    }

    return { added, deleted };
  }, [version, handle]);
}
