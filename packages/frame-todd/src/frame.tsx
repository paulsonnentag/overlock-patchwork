import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";

import { observeAttributes, type StateHandleLike } from "patchwork-dom";
import { registerComponent, useHandle } from "patchwork-solid";

import "./styles.css";

import type { DocumentSelection } from "./types";
import { hasDocumentSelection } from "./types";

const MD_PKG = "automerge:2SPq6hhJpxHLi34fHwS7s91DUzpG";
const SEQ_PKG = "automerge:LW8gWWCBHd5EneM5HXFPCis7koF";
const MERGECRAFT_PKG = "automerge:3CbLFi7qkMd7X8N8BsqEdAocRRuX";
const TLDRAW_PKG = "automerge:2xKiheqTrAvxhr6Mx7uyvHh24xPG";
const BRANCHES_PKG = "automerge:WBPRF3RFAw2zdErhVtb7hY64Uag";
const PATCHWORK_VIEW_PKG = "automerge:2GJUXWeXXtSuEEmuRcThJ85TgLBv";
const SIDEBOARD_PKG = "automerge:4478ripYLMdHptnqfgibXj2LVhbb";

const FRAME_PKG = "automerge:2beoANHD3SCwKVs5EwktStnU8qYn";

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

const notImplemented = () => alert("Not implemented yet");

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
    createSignal<StateHandleLike<DocumentSelection>>();
  const [rootFolderUrl, setRootFolderUrl] = createSignal<string>("");

  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [docSidebarOpen, setDocSidebarOpen] = createSignal(false);
  const [toolEditorOpen, setToolEditorOpen] = createSignal(false);

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

        <div
          class="todd"
          classList={{ "todd--sidebar-closed": !sidebarOpen() }}
        >
          <aside class="todd__sidebar">
            <div class="todd__account">
              <div class="todd__avatar">T</div>
              <span class="todd__account-name">Todd Dev</span>
              <button
                class="todd__icon-button"
                aria-label="Collapse sidebar"
                onClick={() => setSidebarOpen(false)}
              >
                ‹
              </button>
            </div>

            <div class="todd__create-new">
              <div class="todd__section-label">Create New</div>
              <NewMarkdownButton url={rootFolderUrl()} />
              <NewSequencerButton url={rootFolderUrl()} />
              <NewMergecraftButton url={rootFolderUrl()} />
              <NewTldrawButton url={rootFolderUrl()} />
            </div>

            <Sideboard url={rootFolderUrl()} />

            <button
              class="todd__tools"
              onClick={() => setToolEditorOpen((v) => !v)}
            >
              <span>My Tools</span>
            </button>
          </aside>

          <main class="todd__card">
            <CheckedOutBranchProvider>
              <Show
                when={selectionHandle()}
                fallback={
                  <TopBar
                    sidebarOpen={sidebarOpen()}
                    onOpenSidebar={() => setSidebarOpen(true)}
                    docSidebarOpen={docSidebarOpen()}
                    onToggleDocSidebar={() => setDocSidebarOpen((v) => !v)}
                  />
                }
              >
                {(sel) => {
                  const selection = useHandle(sel());
                  return (
                    <>
                      <TopBar
                        sidebarOpen={sidebarOpen()}
                        onOpenSidebar={() => setSidebarOpen(true)}
                        docSidebarOpen={docSidebarOpen()}
                        onToggleDocSidebar={() => setDocSidebarOpen((v) => !v)}
                        activeDocumentUrl={selection().activeDocumentUrl}
                        BranchPicker={BranchPicker}
                      />
                      <div class="todd__body">
                        <Show
                          when={selection().activeDocumentUrl}
                          fallback={<EmptyState />}
                        >
                          {(url) => <PatchworkView url={url()} />}
                        </Show>

                        <Show when={docSidebarOpen()}>
                          <DocSidebar
                            onClose={() => setDocSidebarOpen(false)}
                          />
                        </Show>
                      </div>
                    </>
                  );
                }}
              </Show>
            </CheckedOutBranchProvider>
          </main>

          <Show when={toolEditorOpen()}>
            <ToolDrawer onClose={() => setToolEditorOpen(false)} />
          </Show>
        </div>
      </SelectionProvider>
    ),
    element
  );

  return () => {
    stopObserving();
    dispose();
  };
};

type TopBarProps = {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  docSidebarOpen: boolean;
  onToggleDocSidebar: () => void;
  activeDocumentUrl?: string | null;
  BranchPicker?: ReturnType<typeof registerComponent>;
};

function TopBar(props: TopBarProps) {
  return (
    <header class="todd__topbar">
      <Show when={!props.sidebarOpen}>
        <button
          class="todd__icon-button"
          aria-label="Open sidebar"
          onClick={props.onOpenSidebar}
        >
          ☰
        </button>
      </Show>

      <button class="todd__title" onClick={notImplemented}>
        <span class="todd__title-icon">📄</span>
        <span>Untitled</span>
        <span class="todd__caret">▾</span>
      </button>

      <span class="todd__sync">
        <span class="todd__sync-dot" />
        Synced
      </span>

      <div class="todd__view-toggle">
        <button class="is-active" onClick={notImplemented}>
          Editor
        </button>
        <button onClick={notImplemented}>Raw</button>
      </div>

      <div class="todd__topbar-right">
        <Show
          when={props.activeDocumentUrl && props.BranchPicker}
          fallback={
            <button class="todd__pill" onClick={notImplemented}>
              No branches <span class="todd__caret">▾</span>
            </button>
          }
        >
          {() => {
            const Picker = props.BranchPicker!;
            return (
              <div class="todd__branch-picker">
                <Picker url={props.activeDocumentUrl!} />
              </div>
            );
          }}
        </Show>
        <button class="todd__pill" onClick={notImplemented}>
          💬 Show Comments
        </button>
        <button
          class="todd__icon-button"
          classList={{ "is-active": props.docSidebarOpen }}
          aria-label="Toggle document panel"
          onClick={props.onToggleDocSidebar}
        >
          ⊟
        </button>
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <div class="todd__empty">
      <em>Select a document from the sidebar to begin.</em>
    </div>
  );
}

function DocSidebar(props: { onClose: () => void }) {
  return (
    <aside class="todd__doc-sidebar">
      <div class="todd__doc-sidebar-header">
        <div class="todd__view-toggle">
          <button class="is-active" onClick={notImplemented}>
            Review
          </button>
          <button onClick={notImplemented}>History</button>
        </div>
        <button
          class="todd__icon-button"
          aria-label="Close document panel"
          onClick={props.onClose}
        >
          ›
        </button>
      </div>
      <div class="todd__doc-sidebar-body">
        No comments yet. Add a comment by selecting text in the document.
      </div>
    </aside>
  );
}

function ToolDrawer(props: { onClose: () => void }) {
  return (
    <section class="todd__tool-drawer">
      <header class="todd__tool-drawer-header">
        <span>🔧 Tool Editor</span>
        <button
          class="todd__icon-button"
          aria-label="Close tool editor"
          onClick={props.onClose}
        >
          ▾
        </button>
      </header>
      <div class="todd__tool-drawer-body">
        This is where users can create and edit tools for working with
        documents.
      </div>
    </section>
  );
}
