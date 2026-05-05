import { createEffect } from "solid-js";

import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

export function createDecorationsExtension(decorations: () => DecorationSet) {
  const setDecorations = StateEffect.define<DecorationSet>();

  const field = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setDecorations)) return e.value;
      }
      if (tr.docChanged) return value.map(tr.changes);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const createReconfigureEffect = (view: EditorView) =>
    createEffect(() => {
      const next = decorations();
      if (!next) return;
      view.dispatch({ effects: setDecorations.of(next) });
    });

  return [field, createReconfigureEffect] as const;
}
