import { onCleanup } from "solid-js";

import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";

import type { Prop as AutomergeProp } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";

import { createSyncExtension } from "./extensions/automergeSync";
import { createReadOnlyExtension } from "./extensions/readOnly";
import { createDecorationsExtension } from "./extensions/decorations";

const lookup = <T = unknown,>(
  doc: unknown,
  path: AutomergeProp[],
): T | undefined => {
  let current = doc as Record<string, unknown> | undefined;
  for (const key of path) {
    if (current === undefined || current === null) return undefined;
    current = current[key as string] as Record<string, unknown> | undefined;
  }
  return current as T | undefined;
};

type CodeMirrorProps<T> = {
  handle: DocHandle<T>;
  path: AutomergeProp[];
  extensions?: Extension[];
  decorations?: () => DecorationSet;
  readOnly?: boolean;
};

export function CodeMirror<T>(props: CodeMirrorProps<T>) {
  const initialDoc = () =>
    (props.handle && lookup<string>(props.handle.doc(), props.path)) || "";

  const [syncExtension, createEffectReconfigureSync] = createSyncExtension(
    () => props.handle,
    () => props.path,
    initialDoc,
  );

  const [readOnlyExtension, createEffectReconfigureReadOnly] =
    createReadOnlyExtension(() => !!props.readOnly);

  const [decorationsExtension, createEffectReconfigureDecorations] =
    createDecorationsExtension(() => props.decorations?.() ?? Decoration.none);

  const extensions = [
    ...(props.extensions ?? []),
    decorationsExtension,
    syncExtension,
    readOnlyExtension,
  ];

  const state = EditorState.create({
    doc: initialDoc(),
    extensions,
  });

  const view = new EditorView({ state });

  createEffectReconfigureSync(view);
  createEffectReconfigureReadOnly(view);
  createEffectReconfigureDecorations(view);

  onCleanup(() => view.destroy());

  return view.dom;
}
