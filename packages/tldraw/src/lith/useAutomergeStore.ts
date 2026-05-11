import {
  type TLAnyShapeUtilConstructor,
  type TLRecord,
  type TLStoreWithStatus,
  createTLStore,
  defaultShapeUtils,
  type HistoryEntry,
  getUserPreferences,
  setUserPreferences,
  defaultUserPreferences,
  createPresenceStateDerivation,
  InstancePresenceRecordType,
  computed,
  react,
  type TLStoreSnapshot,
  sortById,
} from "@tldraw/tldraw";
import { useEffect, useState } from "react";
import {
  type DocHandle,
  type DocHandleChangePayload,
} from "@automerge/automerge-repo";
import {
  useLocalAwareness,
  useRemoteAwareness,
} from "@automerge/automerge-repo-react-hooks";

import { applyAutomergePatchesToTLStore } from "./AutomergeToTLStore";
import { applyTLStoreChangesToAutomerge } from "./TLStoreToAutomerge";

export function useAutomergeStore({
  handle,
  shapeUtils = [],
}: {
  handle: DocHandle<TLStoreSnapshot>;
  userId: string;
  shapeUtils?: TLAnyShapeUtilConstructor[];
}): TLStoreWithStatus {
  const [store] = useState(() => {
    return createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    });
  });

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: "loading",
  });

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // Local writes flow tldraw -> automerge. The roundtripped patch
    // would re-enter as a remote change; guard against re-applying it.
    let preventPatchApplications = false;

    function syncStoreChangesToAutomergeDoc({
      changes,
    }: HistoryEntry<TLRecord>) {
      preventPatchApplications = true;
      handle.change((doc) => {
        applyTLStoreChangesToAutomerge(doc, changes);
      });
      preventPatchApplications = false;
    }

    unsubs.push(
      store.listen(syncStoreChangesToAutomergeDoc, {
        source: "user",
        scope: "document",
      })
    );

    const syncAutomergeDocChangesToStore = ({
      patches,
    }: DocHandleChangePayload<any>) => {
      if (preventPatchApplications) return;

      applyAutomergePatchesToTLStore(patches, store);
    };

    handle.on("change", syncAutomergeDocChangesToStore);
    unsubs.push(() => handle.off("change", syncAutomergeDocChangesToStore));

    handle.whenReady().then(() => {
      const doc = handle.doc();
      if (!doc) throw new Error("Document not found");
      if (!doc.store) throw new Error("Document store not initialized");

      store.mergeRemoteChanges(() => {
        store.loadStoreSnapshot({
          store: JSON.parse(JSON.stringify(doc.store)),
          schema: JSON.parse(JSON.stringify(doc.schema)),
        });
      });

      setStoreWithStatus({
        store,
        status: "synced-remote",
        connectionStatus: "online",
      });
    });

    return () => {
      unsubs.forEach((fn) => fn());
      unsubs.length = 0;
    };
  }, [handle, store]);

  return storeWithStatus;
}

export function useAutomergePresence({
  handle,
  store,
  userMetadata,
}: {
  handle: DocHandle<TLStoreSnapshot>;
  store: TLStoreWithStatus;
  userMetadata: any;
}) {
  const innerStore = store?.store;

  const { userId, name, color } = userMetadata;

  const [, updateLocalState] = useLocalAwareness({
    handle,
    userId,
    initialState: {},
  });

  const [peerStates] = useRemoteAwareness({
    handle,
    localUserId: userId,
  });

  useEffect(() => {
    if (!innerStore) return;

    const toPut: TLRecord[] = Object.values(peerStates).filter(
      (record) => record && Object.keys(record).length !== 0
    );

    const toRemove = innerStore.query
      .records("instance_presence")
      .get()
      .sort(sortById)
      .map((record) => record.id)
      .filter((id) => !toPut.find((record) => record.id === id));

    if (toRemove.length) innerStore.remove(toRemove);
    if (toPut.length) innerStore.put(toPut);
  }, [innerStore, peerStates]);

  useEffect(() => {
    if (!innerStore) return;
    setUserPreferences({ id: userId, color, name });

    const userPreferences = computed<{
      id: string;
      color: string;
      name: string;
    }>("userPreferences", () => {
      const user = getUserPreferences();
      return {
        id: user.id,
        color: user.color ?? defaultUserPreferences.color,
        name: user.name ?? defaultUserPreferences.name,
      };
    });

    const presenceId = InstancePresenceRecordType.createId(userId);
    const presenceDerivation = createPresenceStateDerivation(
      userPreferences,
      presenceId
    )(innerStore);

    return react("when presence changes", () => {
      const presence = presenceDerivation.get();
      requestAnimationFrame(() => {
        updateLocalState(presence);
      });
    });
  }, [innerStore, userId, updateLocalState]);
}
