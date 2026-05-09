import { Show, createSignal } from "solid-js"
import { render } from "solid-js/web"

import type { DocHandle } from "@automerge/automerge-repo"

import { StateHandle } from "patchwork-dom"
import { registerComponent, useHandle } from "patchwork-solid"

import "./styles.css"

import type { AccountDoc, DocumentSelection } from "./types"
import { hasAccountHandle, hasDocumentSelection } from "./types"

const FRAME_PKG = "automerge:2Q6XWP6H1soyS1RFW7bzm6rabjnZ"
const MD_PKG = "automerge:MgZABPTTW3m3xzAyBhEX4SMJ5ao"
const SEQ_PKG = "automerge:3W3MzsQTqGqw9cpuHEezd7EAB365"
const BRANCHES_PKG = "automerge:YPhgkbKsr2zAzZgc5h9UuauZCux"
const PLUGINS_PROVIDER_PKG = "automerge:3LdPUwM4U8Tbje9YWJoRmKQbDzVm"
const PATCHWORK_VIEW_PKG = "automerge:xaKTpEarZWtWpeiihMD4XLDkq8g"

const ACCOUNT_PROVIDER_URL = `${FRAME_PKG}/dist/account-provider-component.json`
const SELECTION_PROVIDER_URL = `${FRAME_PKG}/dist/document-selection-provider-component.json`
const SELECTION_URL_SYNC_URL = `${FRAME_PKG}/dist/document-selection-url-sync-component.json`
const FOLDER_LIST_URL = `${FRAME_PKG}/dist/folder-list-component.json`
const PLUGINS_PROVIDER_URL = `${PLUGINS_PROVIDER_PKG}/dist/plugins-provider-component.json`
const PATCHWORK_VIEW_URL = `${PATCHWORK_VIEW_PKG}/dist/patchwork-view-component.json`
const NEW_MARKDOWN_BUTTON_URL = `${MD_PKG}/dist/new-markdown-button-component.json`
const NEW_SEQUENCER_BUTTON_URL = `${SEQ_PKG}/dist/new-sequencer-button-component.json`
const CHECKED_OUT_BRANCH_PROVIDER_URL = `${BRANCHES_PKG}/dist/checked-out-branch-provider-component.json`
const BRANCH_PICKER_URL = `${BRANCHES_PKG}/dist/branch-picker-component.json`

export default (element: HTMLElement) => {
  const AccountProvider = registerComponent(element, ACCOUNT_PROVIDER_URL)
  const SelectionProvider = registerComponent(element, SELECTION_PROVIDER_URL)
  const SelectionUrlSync = registerComponent(element, SELECTION_URL_SYNC_URL)
  const FolderList = registerComponent(element, FOLDER_LIST_URL)
  const PluginsProvider = registerComponent(element, PLUGINS_PROVIDER_URL)
  const PatchworkView = registerComponent(element, PATCHWORK_VIEW_URL)
  const NewMarkdownButton = registerComponent(element, NEW_MARKDOWN_BUTTON_URL)
  const NewSequencerButton = registerComponent(
    element,
    NEW_SEQUENCER_BUTTON_URL,
  )
  const CheckedOutBranchProvider = registerComponent(
    element,
    CHECKED_OUT_BRANCH_PROVIDER_URL,
  )
  const BranchPicker = registerComponent(element, BRANCH_PICKER_URL)

  const [accountHandle, setAccountHandle] =
    createSignal<DocHandle<AccountDoc>>()
  const [selectionHandle, setSelectionHandle] =
    createSignal<StateHandle<DocumentSelection>>()

  const onAccountMounted = (el: HTMLElement) => {
    if (hasAccountHandle(el)) setAccountHandle(el.handle)
  }

  const onSelectionMounted = (el: HTMLElement) => {
    if (hasDocumentSelection(el)) setSelectionHandle(el.handle)
  }

  return render(
    () => (
      <AccountProvider onMounted={onAccountMounted}>
        <Show when={accountHandle()}>
          {(handle) => {
            const account = useHandle(handle())
            return (
              <SelectionProvider onMounted={onSelectionMounted}>
                <SelectionUrlSync />
                <PluginsProvider url={account.packagesFolderUrl}>
                  <div class="frame__sidebar">
                    <NewMarkdownButton url={account.rootFolderUrl} />
                    <NewSequencerButton url={account.rootFolderUrl} />
                    <FolderList url={account.rootFolderUrl} />
                  </div>
                  <CheckedOutBranchProvider>
                    <Show when={selectionHandle()}>
                      {(sel) => {
                        const selection = useHandle(sel())
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
                        )
                      }}
                    </Show>
                  </CheckedOutBranchProvider>
                </PluginsProvider>
              </SelectionProvider>
            )
          }}
        </Show>
      </AccountProvider>
    ),
    element,
  )
}
