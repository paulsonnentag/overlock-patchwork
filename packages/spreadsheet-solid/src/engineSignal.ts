import { createSignal, onCleanup, type Accessor } from "solid-js";

import type { CellKey, CellState, Engine } from "spreadsheet";

export type CellSignal<V> = Accessor<CellState<V>>;

export function createEngineSignals<V>(
  engine: Engine<V>,
): (key: CellKey) => CellSignal<V> {
  type Entry = { read: Accessor<CellState<V>>; write: (s: CellState<V>) => void };
  const sigs = new Map<CellKey, Entry>();

  const ensure = (key: CellKey): Entry => {
    let e = sigs.get(key);
    if (!e) {
      const [read, write] = createSignal<CellState<V>>(engine.get(key), {
        equals: false,
      });
      e = { read, write };
      sigs.set(key, e);
    }
    return e;
  };

  const unsubscribe = engine.subscribe((changed) => {
    for (const k of changed) {
      const e = sigs.get(k);
      if (e) e.write(engine.get(k));
    }
  });
  onCleanup(unsubscribe);

  return (key: CellKey) => ensure(key).read;
}
