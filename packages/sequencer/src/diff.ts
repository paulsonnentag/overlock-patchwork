import { useEffect, useMemo, useState } from "react";

import type { Patch } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";

import type { SequencerDoc } from "./datatype";

export type DiffSets = { added: Set<string>; deleted: Set<string> };
export type GridDiff = { instrument: DiffSets; drum: DiffSets };

const EMPTY: DiffSets = { added: new Set(), deleted: new Set() };
export const EMPTY_GRID_DIFF: GridDiff = { instrument: EMPTY, drum: EMPTY };

export function useDiff(handle: DocHandle<SequencerDoc>): GridDiff {
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
    // TODO: `diff` will move onto DocHandle itself; drop the cast then.
    const patches =
      (handle as unknown as { diff?: () => Patch[] }).diff?.() ?? [];
    if (patches.length === 0) return EMPTY_GRID_DIFF;

    const instrument: DiffSets = { added: new Set(), deleted: new Set() };
    const drum: DiffSets = { added: new Set(), deleted: new Set() };

    for (const patch of patches) {
      const [field, y, x, prop] = patch.path;
      if (
        prop !== "toggled" ||
        typeof y !== "number" ||
        typeof x !== "number"
      ) {
        continue;
      }
      const sets =
        field === "toggleRows"
          ? instrument
          : field === "drumToggleRows"
            ? drum
            : null;
      if (!sets) continue;

      const key = `${y}:${x}`;
      if (patch.action === "put" && (patch as { value?: unknown }).value === true) {
        sets.added.add(key);
      } else if (
        patch.action === "put" &&
        (patch as { value?: unknown }).value === false
      ) {
        sets.deleted.add(key);
      }
    }

    return { instrument, drum };
  }, [version, handle]);
}
