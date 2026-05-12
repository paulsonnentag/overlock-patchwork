import { forwardRef, useEffect } from "react";
import type { DocHandle } from "@automerge/automerge-repo";

import {
  DefaultShapeWrapper,
  atom,
  useValue,
  type TLShape,
  type TLShapeId,
  type TLShapeWrapperProps,
  type TLStore,
} from "@tldraw/tldraw";

import type { TLDrawDoc } from "./datatype";

// `BranchedDocHandle.forkSnapshot()` lives in the `branches` package;
// duck-typed here to avoid a dep from tldraw -> branches.
type WithForkSnapshot<T> = {
  forkSnapshot?: () => DocHandle<T> | null;
};

type DiffSets = {
  added: ReadonlySet<TLShapeId>;
  modified: ReadonlySet<TLShapeId>;
};

const EMPTY: DiffSets = { added: new Set(), modified: new Set() };

const diffAtom = atom<DiffSets>("tldraw-diff", EMPTY);

export function useTldrawDiff({
  handle,
  store,
}: {
  handle: DocHandle<TLDrawDoc>;
  store: TLStore;
}) {
  useEffect(() => {
    let injectedGhostIds: TLShapeId[] = [];

    const recompute = () => {
      const baseHandle = (
        handle as unknown as WithForkSnapshot<TLDrawDoc>
      ).forkSnapshot?.();

      const branchStore = handle.doc()?.store ?? {};
      const baseStore = baseHandle?.doc()?.store ?? {};

      const added = new Set<TLShapeId>();
      const modified = new Set<TLShapeId>();
      const ghosts: TLShape[] = [];

      if (baseHandle) {
        for (const [id, record] of Object.entries(branchStore)) {
          if (!isShape(record)) continue;
          const base = baseStore[id];
          if (!base) {
            added.add(id as TLShapeId);
          } else if (
            isShape(base) &&
            shapeFingerprint(record) !== shapeFingerprint(base)
          ) {
            modified.add(id as TLShapeId);
          }
        }
        for (const [id, record] of Object.entries(baseStore)) {
          if (!isShape(record)) continue;
          if (branchStore[id]) continue;
          ghosts.push({
            ...record,
            meta: { ...record.meta, diff: "deleted" },
            isLocked: true,
          });
        }
      }

      diffAtom.set({ added, modified });

      const nextIds = ghosts.map((g) => g.id);
      const toRemove = injectedGhostIds.filter((id) => !nextIds.includes(id));
      if (toRemove.length || ghosts.length) {
        store.mergeRemoteChanges(() => {
          if (toRemove.length) store.remove(toRemove);
          if (ghosts.length) store.put(ghosts);
        });
      }
      injectedGhostIds = nextIds;
    };

    recompute();
    handle.on("change", recompute);
    handle.on("heads-changed", recompute);

    return () => {
      handle.off("change", recompute);
      handle.off("heads-changed", recompute);
      if (injectedGhostIds.length) {
        store.mergeRemoteChanges(() => store.remove(injectedGhostIds));
      }
      diffAtom.set(EMPTY);
    };
  }, [handle, store]);
}

export const DiffShapeWrapper = forwardRef<HTMLDivElement, TLShapeWrapperProps>(
  function DiffShapeWrapper({ children, shape, isBackground, ...rest }, ref) {
    const className = useValue(
      "diff-class",
      () => {
        if ((shape.meta as { diff?: string } | undefined)?.diff === "deleted") {
          return "diff-deleted";
        }
        const { added, modified } = diffAtom.get();
        if (added.has(shape.id)) return "diff-added";
        if (modified.has(shape.id)) return "diff-modified";
        return undefined;
      },
      [shape.id, shape.meta]
    );
    return (
      <DefaultShapeWrapper
        {...rest}
        ref={ref}
        shape={shape}
        isBackground={isBackground}
        className={className}
      >
        {children}
      </DefaultShapeWrapper>
    );
  }
);

function isShape(record: unknown): record is TLShape {
  return (
    !!record &&
    typeof record === "object" &&
    (record as { typeName?: string }).typeName === "shape"
  );
}

function shapeFingerprint(shape: TLShape): string {
  return JSON.stringify({
    type: shape.type,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    index: shape.index,
    parentId: shape.parentId,
    isLocked: shape.isLocked,
    opacity: shape.opacity,
    props: shape.props,
    meta: shape.meta,
  });
}
