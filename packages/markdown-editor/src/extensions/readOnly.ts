import { createEffect } from "solid-js";

import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";

/**
 * CodeMirror extension wired into a Compartment so the editor's
 * read-only state can be flipped without rebuilding the EditorView.
 */
export function createReadOnlyExtension(readOnly: () => boolean) {
  const readOnlyCompartment = new Compartment();

  const readOnlyExtensions = () =>
    readOnly()
      ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
      : [];

  const createReconfigureEffect = (view: EditorView) =>
    createEffect(() => {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(readOnlyExtensions()),
      });
    });

  return [
    readOnlyCompartment.of(readOnlyExtensions()),
    createReconfigureEffect,
  ] as const;
}
