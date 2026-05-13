import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";

import { observeAttributes, StateHandle } from "patchwork-dom";
import { registerComponent, useHandle } from "patchwork-solid";

import "./styles.css";

import type { DocumentSelection } from "./types";
import { hasDocumentSelection } from "./types";

const FRAME_PKG = "automerge:jdzc7uxAMQzWx5v2MBSZjzvBnMA";
const MD_PKG = "automerge:2SPq6hhJpxHLi34fHwS7s91DUzpG";
const SEQ_PKG = "automerge:LW8gWWCBHd5EneM5HXFPCis7koF";
const MERGECRAFT_PKG = "automerge:3CbLFi7qkMd7X8N8BsqEdAocRRuX";
const TLDRAW_PKG = "automerge:2xKiheqTrAvxhr6Mx7uyvHh24xPG";
const BRANCHES_PKG = "automerge:WBPRF3RFAw2zdErhVtb7hY64Uag";
const PATCHWORK_VIEW_PKG = "automerge:2GJUXWeXXtSuEEmuRcThJ85TgLBv";
const SIDEBOARD_PKG = "automerge:4478ripYLMdHptnqfgibXj2LVhbb";

const SELECTION_PROVIDER_URL = `${FRAME_PKG}/dist/document-selection-provider-component.json`;
const SELECTION_URL_SYNC_URL = `${FRAME_PKG}/dist/document-selection-url-sync-component.json`;
const SIDEBOARD_URL = `${SIDEBOARD_PKG}/dist/chee-sideboard-component.json`;
const PATCHWORK_VIEW_URL = `${PATCHWORK_VIEW_PKG}/dist/patchwork-view-component.json`;
const NEW_MARKDOWN_BUTTON_URL = `${MD_PKG}/dist/new-markdown-button-component.json`;
const NEW_SEQUENCER_BUTTON_URL = `${SEQ_PKG}/dist/new-sequencer-button-component.json`;
const NEW_MERGECRAFT_BUTTON_URL = `${MERGECRAFT_PKG}/dist/new-mergecraft-button-component.json`;
const NEW_TLDRAW_BUTTON_URL = `${TLDRAW_PKG}/dist/new-tldraw-button-component.json`;
const CHECKED_OUT_BRANCH_PROVIDER_URL = `${BRANCHES_PKG}/dist/checked-out-branch-provider-component.json`;
const BRANCH_PICKER_URL = `${BRANCHES_PKG}/dist/branch-picker-component.json`;

export default (element: HTMLElement) => {
  const SelectionProvider = registerComponent(element, SELECTION_PROVIDER_URL);
  const SelectionUrlSync = registerComponent(element, SELECTION_URL_SYNC_URL);
  const Sideboard = registerComponent(element, SIDEBOARD_URL);
  const PatchworkView = registerComponent(element, PATCHWORK_VIEW_URL);
  const NewMarkdownButton = registerComponent(element, NEW_MARKDOWN_BUTTON_URL);
  const NewSequencerButton = registerComponent(
    element,
    NEW_SEQUENCER_BUTTON_URL
  );
  const NewMergecraftButton = registerComponent(
    element,
    NEW_MERGECRAFT_BUTTON_URL
  );
  const NewTldrawButton = registerComponent(element, NEW_TLDRAW_BUTTON_URL);

  const CheckedOutBranchProvider = registerComponent(
    element,
    CHECKED_OUT_BRANCH_PROVIDER_URL
  );
  const BranchPicker = registerComponent(element, BRANCH_PICKER_URL);

  const [selectionHandle, setSelectionHandle] =
    createSignal<StateHandle<DocumentSelection>>();
  const [rootFolderUrl, setRootFolderUrl] = createSignal<string>("");

  const onSelectionMounted = (el: HTMLElement) => {
    if (hasDocumentSelection(el)) setSelectionHandle(el.handle);
  };

  const stopObserving = observeAttributes(element, {
    url: (value) => setRootFolderUrl(value ?? ""),
  });
  setRootFolderUrl(element.getAttribute("url") ?? "");

  const dispose = render(
    () => (
      <SelectionProvider onMounted={onSelectionMounted}>
        <SelectionUrlSync />
        <div class="frame__sidebar">
          v 0.3
          <NewMarkdownButton url={rootFolderUrl()} />
          <NewSequencerButton url={rootFolderUrl()} />
          <NewMergecraftButton url={rootFolderUrl()} />
          <NewTldrawButton url={rootFolderUrl()} />
          <Sideboard url={rootFolderUrl()} />
        </div>
        <CheckedOutBranchProvider>
          <Show when={selectionHandle()}>
            {(sel) => {
              const selection = useHandle(sel());
              return (
                <Show when={selection().activeDocumentUrl}>
                  {(url) => (
                    <>
                      <div class="frame__branch-bar">
                        <BranchPicker url={url()} />
                      </div>
                      <PatchworkView url={url()} />
                    </>
                  )}
                </Show>
              );
            }}
          </Show>
        </CheckedOutBranchProvider>
      </SelectionProvider>
    ),
    element
  );

  return () => {
    stopObserving();
    dispose();
  };
};
