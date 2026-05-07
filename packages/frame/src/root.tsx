import { Show, createSignal } from "solid-js"
import { render } from "solid-js/web"

import type { DocHandle } from "@automerge/automerge-repo"

import { StateHandle } from "patchwork-dom"
import { registerComponent, useHandle } from "patchwork-solid"

import "./styles.css"

import type { AccountDoc, DocumentSelection } from "./types"
import { hasAccountHandle, hasDocumentSelection } from "./types"

const FRAME_PKG = "automerge:2Q6XWP6H1soyS1RFW7bzm6rabjnZ/dist/package.json"
const MD_PKG = "automerge:MgZABPTTW3m3xzAyBhEX4SMJ5ao/dist/package.json"
const BRANCHES_PKG = "automerge:YPhgkbKsr2zAzZgc5h9UuauZCux/dist/package.json"

const ACCOUNT_PROVIDER_URL = `${FRAME_PKG}#components/account-provider`
const SELECTION_PROVIDER_URL = `${FRAME_PKG}#components/document-selection-provider`
const SELECTION_URL_SYNC_URL = `${FRAME_PKG}#components/document-selection-url-sync`
const FOLDER_LIST_URL = `${FRAME_PKG}#components/folder-list`
const PACKAGE_REGISTRY_PROVIDER_URL = `${FRAME_PKG}#components/package-registry-provider`
const SINGLE_VIEW_URL = `${FRAME_PKG}#components/single-view`
const NEW_MARKDOWN_BUTTON_URL = `${MD_PKG}#components/new-markdown-button`
const CHECKED_OUT_BRANCH_PROVIDER_URL = `${BRANCHES_PKG}#components/checked-out-branch-provider`
const BRANCH_PICKER_URL = `${BRANCHES_PKG}#components/branch-picker`

export default (element: HTMLElement) => {
  const AccountProvider = registerComponent(element, ACCOUNT_PROVIDER_URL)
  const SelectionProvider = registerComponent(element, SELECTION_PROVIDER_URL)
  const SelectionUrlSync = registerComponent(element, SELECTION_URL_SYNC_URL)
  const FolderList = registerComponent(element, FOLDER_LIST_URL)
  const PackageRegistryProvider = registerComponent(
    element,
    PACKAGE_REGISTRY_PROVIDER_URL,
  )
  const SingleView = registerComponent(element, SINGLE_VIEW_URL)
  const NewMarkdownButton = registerComponent(element, NEW_MARKDOWN_BUTTON_URL)
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
