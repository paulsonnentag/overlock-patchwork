import type { RecordsDiff, TLRecord } from "@tldraw/tldraw";
import { isObject, forIn, isArray, mapValues } from "lodash";

import type { TLDrawDoc } from "../datatype";

// Recurse the value before writing to automerge. tldraw can produce
// very large strings for inline assets, and automerge has no native
// merge for tldraw strings anyway, so storing them as plain values is
// the cheapest correct option.
export function tldrawValueToAutomergeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(tldrawValueToAutomergeValue);
  }
  if (isObject(value)) {
    return mapValues(value, tldrawValueToAutomergeValue);
  }
  return value;
}

export function applyTLStoreChangesToAutomerge(
  doc: TLDrawDoc,
  changes: RecordsDiff<TLRecord>
) {
  Object.values(changes.added).forEach((record) => {
    doc.store[record.id] = tldrawValueToAutomergeValue(record);
  });

  Object.values(changes.updated).forEach(([_, record]) => {
    deepCompareAndUpdate(doc.store[record.id], record);
  });

  Object.values(changes.removed).forEach((record) => {
    delete doc.store[record.id];
  });
}

function deepCompareAndUpdate(objectA: any, objectB: any) {
  if (isArray(objectB)) {
    if (!isArray(objectA)) {
      objectA = objectB.map(tldrawValueToAutomergeValue);
    } else {
      for (let i = 0; i < objectB.length; i++) {
        if (i >= objectA.length) {
          objectA.push(tldrawValueToAutomergeValue(objectB[i]));
        } else {
          if (isObject(objectB[i]) || isArray(objectB[i])) {
            deepCompareAndUpdate(objectA[i], objectB[i]);
          } else if (objectA[i] !== objectB[i]) {
            objectA[i] = tldrawValueToAutomergeValue(objectB[i]);
          }
        }
      }
      if (objectA.length > objectB.length) {
        objectA.splice(objectB.length);
      }
    }
  } else if (isObject(objectB)) {
    forIn(objectB, (value: any, key: any) => {
      if (objectA[key] === undefined) {
        objectA[key] = tldrawValueToAutomergeValue(value);
      } else {
        if (isObject(value) || isArray(value)) {
          deepCompareAndUpdate(objectA[key], value);
        } else if (objectA[key] !== value) {
          objectA[key] = tldrawValueToAutomergeValue(value);
        }
      }
    });
    forIn(objectA, (_: any, key: string) => {
      if ((objectB as any)[key] === undefined) {
        delete objectA[key];
      }
    });
  }
}
