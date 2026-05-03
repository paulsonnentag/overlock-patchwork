import { onCleanup } from "solid-js";
import { createStore, produce, type Store } from "solid-js/store";
import type { DocHandle, DocHandleChangePayload } from "@automerge/automerge-repo";

import type { Engine, Sheet } from "spreadsheet";

// Subscribes once to the handle's `change` event and dispatches each
// touched key to (a) the engine and (b) a fine-grained Solid store
// mirroring the doc. Each `change` payload carries Automerge's
// already-computed patches, so no diffing on our side. Action types
// (put / del / splice into a Text-typed cell) all collapse to the
// same response: re-read `doc[k]` and push it.
export function bindSheet<V>(
  handle: DocHandle<Sheet>,
  engine: Engine<V>,
): Store<Sheet> {
  const initial = handle.doc() ?? {};
  const [sheet, setSheet] = createStore<Sheet>({ ...initial });

  for (const [k, v] of Object.entries(initial)) {
    if (typeof v === "string") engine.setCell(k, v);
  }

  const onChange = ({ doc, patches }: DocHandleChangePayload<Sheet>) => {
    const touched = new Set<string>();
    for (const p of patches) {
      if (p.path.length === 0) continue;
      const head = p.path[0];
      if (typeof head === "string") touched.add(head);
    }
    for (const k of touched) {
      const v = (doc as Sheet)[k];
      if (typeof v === "string") {
        engine.setCell(k, v);
        setSheet(k, v);
      } else {
        engine.deleteCell(k);
        setSheet(produce((s) => { delete s[k]; }));
      }
    }
  };

  handle.on("change", onChange);
  onCleanup(() => handle.off("change", onChange));

  return sheet;
}
