import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";

import {
  getRepo,
  isStateHandle,
  observeAttributes,
  readHandle,
  StateHandle,
  type ElementWithHandle,
} from "patchwork-dom";

import type {
  FolderDoc,
  UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";

export type Plugins = {
  plugins: { [url: string]: { name: string; [key: string]: unknown } };
};

export function hasPluginsProvider(
  el: HTMLElement
): el is ElementWithHandle<StateHandle<Plugins>> {
  const handle = readHandle(el);
  if (!isStateHandle(handle)) return false;
  return handle.value instanceof Map;
}

export default (element: HTMLElement) => {
  const repo = getRepo(element);
  const state = new StateHandle<Plugins>({
    plugins: {},
  });
  Object.assign(element, { handle: state });
  element.style.display = "contents";

  const onUrl = async (raw: string | null) => {
    console.log(raw);
  };

  // Install the property↔attribute bridge before the initial read so a
  // pending `el.url = ...` assignment from the framework lands as an
  // attribute first.
  const stopObserving = observeAttributes(element, {
    url: (value) => onUrl(value),
  });

  onUrl(element.getAttribute("url"));

  return () => {
    stopObserving();
  };
};
