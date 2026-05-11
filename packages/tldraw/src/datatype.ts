import {
  createTLStore,
  defaultShapeUtils,
  type SerializedSchema,
  type SerializedStore,
  type TLPage,
  type TLPageId,
  type TLRecord,
  type TLShapeId,
} from "@tldraw/tldraw";

import { tldrawValueToAutomergeValue } from "./lith/TLStoreToAutomerge";

export type TLDrawDoc = {
  store: SerializedStore<TLRecord>;
  schema: SerializedSchema;
};

export type TLDrawDocAnchor = TLShapeId;

const pageKey = "page:page" as TLPageId;

export const getTitle = (doc: TLDrawDoc) => {
  const page = doc.store[pageKey] as TLPage;
  return page.name.toString() || "Canvas";
};

export const setTitle = (doc: TLDrawDoc, title: string) => {
  const page = doc.store[pageKey] as TLPage;
  page.name = title;
};

export const init = (doc: TLDrawDoc) => {
  Object.assign(
    doc,
    tldrawValueToAutomergeValue(
      createTLStore({
        shapeUtils: defaultShapeUtils,
      }).getStoreSnapshot()
    )
  );
  doc.store[pageKey] = {
    meta: {},
    id: "page:page" as TLPageId,
    index: "a1" as TLPage["index"],
    name: "New tldraw",
    typeName: "page",
  };
};

export const defaultTldrawDoc = (): TLDrawDoc => {
  const doc = { store: {}, schema: {} } as unknown as TLDrawDoc;
  init(doc);
  return doc;
};

export const dataType = {
  init,
  getTitle,
  setTitle,
};
