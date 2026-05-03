import { createEffect } from "solid-js";

import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";

import type { Prop as AutomergeProp } from "@automerge/automerge";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import type { DocHandle } from "@automerge/automerge-repo";

// Wrapped in a `Compartment` so handle/path can be swapped without
// rebuilding the EditorView.
export function createSyncExtension<T>(
  handle: () => DocHandle<T>,
  path: () => AutomergeProp[],
  initialDoc: () => string,
) {
  const sync = new Compartment();

  const syncExtension = () =>
    handle() && path()
      ? automergeSyncPlugin({
          handle: handle() as Parameters<typeof automergeSyncPlugin>[0]["handle"],
          path: path(),
        })
      : [];

  const createReconfigureEffect = (view: EditorView) =>
    createEffect(() => {
      view.dispatch({
        effects: sync.reconfigure(syncExtension()),
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: initialDoc(),
        },
      });
    });

  return [sync.of(syncExtension()), createReconfigureEffect] as const;
}
