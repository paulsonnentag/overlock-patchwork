import { Show, createSignal } from "solid-js"
import { render } from "solid-js/web"

import type { DocHandle } from "@automerge/automerge-repo"

import { StateHandle } from "patchwork-dom"
import { registerView, useHandle } from "patchwork-solid"

import "./styles.css"

import type { AccountDoc, DocumentSelection } from "./types"
import { hasAccountHandle, hasDocumentSelection } from "./types"

const FRAME_PKG = "automerge:2Q6XWP6H1soyS1RFW7bzm6rabjnZ/dist"
const MD_PKG = "automerge:MgZABPTTW3m3xzAyBhEX4SMJ5ao/dist"
const BRANCHES_PKG = "automerge:YPhgkbKsr2zAzZgc5h9UuauZCux/dist"

const ACCOUNT_PROVIDER_SRC = `${FRAME_PKG}/account-provider.json`
const SELECTION_PROVIDER_SRC = `${FRAME_PKG}/document-selection-provider.json`
const SELECTION_URL_SYNC_SRC = `${FRAME_PKG}/document-selection-url-sync.json`
const FOLDER_LIST_SRC = `${FRAME_PKG}/folder-list.json`
const PACKAGE_REGISTRY_PROVIDER_SRC = `${FRAME_PKG}/package-registry-provider.json`
const SINGLE_VIEW_SRC = `${FRAME_PKG}/single-view.json`
const NEW_MARKDOWN_BUTTON_SRC = `${MD_PKG}/new-markdown-button.json`
const CHECKED_OUT_BRANCH_PROVIDER_SRC = `${BRANCHES_PKG}/checked-out-branch-provider.json`
const BRANCH_PICKER_SRC = `${BRANCHES_PKG}/branch-picker.json`

export default (element: HTMLElement) => {
  const AccountProvider = registerView(element, ACCOUNT_PROVIDER_SRC)
  const SelectionProvider = registerView(element, SELECTION_PROVIDER_SRC)
  const SelectionUrlSync = registerView(element, SELECTION_URL_SYNC_SRC)
  const FolderList = registerView(element, FOLDER_LIST_SRC)
  const PackageRegistryProvider = registerView(
    element,
    PACKAGE_REGISTRY_PROVIDER_SRC,
  )
  const SingleView = registerView(element, SINGLE_VIEW_SRC)
  const NewMarkdownButton = registerView(element, NEW_MARKDOWN_BUTTON_SRC)
  const CheckedOutBranchProvider = registerView(
    element,
    CHECKED_OUT_BRANCH_PROVIDER_SRC,
  )
  const BranchPicker = registerView(element, BRANCH_PICKER_SRC)

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
                <PackageRegistryProvider url={account.packagesFolderUrl}>
                  <div class="frame__sidebar">
                    <NewMarkdownButton url={account.rootFolderUrl} />
                    <FolderList url={account.rootFolderUrl} />
                  </div>
                  <CheckedOutBranchProvider>
                    <Show when={selectionHandle()}>
                      {(sel) => {
                        const selection = useHandle(sel())
                        return (
                          <Show when={selection().activeDocumentUrl}>
                            {(url) => (
                              <div class="frame__branch-bar">
                                <BranchPicker url={url()} />
                              </div>
                            )}
                          </Show>
                        )
                      }}
                    </Show>
                    <SingleView />
                  </CheckedOutBranchProvider>
                </PackageRegistryProvider>
              </SelectionProvider>
            )
          }}
        </Show>
      </AccountProvider>
    ),
    element,
  )
}
