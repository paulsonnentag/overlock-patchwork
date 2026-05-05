import { Show, createSignal } from "solid-js"
import { render } from "solid-js/web"

import type { DocHandle } from "@automerge/automerge-repo"

import {
  defineView,
  makeDocumentProjection,
  makeStateProjection,
  StateHandle,
  type ViewElement,
} from "patchwork-solid"

import "./styles.css"

import type { AccountDoc, DocumentSelection } from "./types"
import { isDocumentSelectionHandle } from "./types"

const FRAME_PKG = "automerge:3t8ivUxWittXbhnmz5ZLVCMPqxJC/dist"
const MD_PKG = "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/dist"
const BRANCHES_PKG = "automerge:2A8Z1TgGe2C5cVcvvnZHNZ53X6no/dist"

const ACCOUNT_CONTEXT_SRC = `${FRAME_PKG}/account-context.json`
const SELECTION_CONTEXT_SRC = `${FRAME_PKG}/document-selection-context.json`
const SELECTION_URL_SYNC_SRC = `${FRAME_PKG}/document-selection-url-sync.json`
const FOLDER_LIST_SRC = `${FRAME_PKG}/folder-list.json`
const PACKAGE_REGISTRY_CONTEXT_SRC = `${FRAME_PKG}/package-registry-context.json`
const SINGLE_VIEW_SRC = `${FRAME_PKG}/single-view.json`
const NEW_MARKDOWN_BUTTON_SRC = `${MD_PKG}/new-markdown-button.json`
const CHECKED_OUT_BRANCH_CONTEXT_SRC = `${BRANCHES_PKG}/checked-out-branch-context.json`
const BRANCH_PICKER_SRC = `${BRANCHES_PKG}/branch-picker.json`

export default defineView(({ element, registerView }) => {
  const AccountContext = registerView<AccountDoc>(ACCOUNT_CONTEXT_SRC)
  const SelectionContext = registerView(SELECTION_CONTEXT_SRC)
  const SelectionUrlSync = registerView(SELECTION_URL_SYNC_SRC)
  const FolderList = registerView(FOLDER_LIST_SRC)
  const PackageRegistryContext = registerView(PACKAGE_REGISTRY_CONTEXT_SRC)
  const SingleView = registerView(SINGLE_VIEW_SRC)
  const NewMarkdownButton = registerView(NEW_MARKDOWN_BUTTON_SRC)
  const CheckedOutBranchContext = registerView(CHECKED_OUT_BRANCH_CONTEXT_SRC)
  const BranchPicker = registerView(BRANCH_PICKER_SRC)

  const [accountHandle, setAccountHandle] =
    createSignal<DocHandle<AccountDoc>>()
  const [selectionHandle, setSelectionHandle] =
    createSignal<StateHandle<DocumentSelection>>()

  const onSelectionMounted = (el: ViewElement) => {
    const value = (el as HTMLElement & { value?: unknown }).value
    if (isDocumentSelectionHandle(value)) setSelectionHandle(value)
  }

  return render(
    () => (
      <AccountContext
        onMounted={(el: ViewElement<AccountDoc>) =>
          setAccountHandle(el.handle)
        }
      >
        <Show when={accountHandle()}>
          {(handle) => {
            const account = makeDocumentProjection(handle())
            return (
              <SelectionContext onMounted={onSelectionMounted}>
                <SelectionUrlSync />
                <PackageRegistryContext url={account().packagesFolderUrl}>
                  <div class="frame__sidebar">
                    <NewMarkdownButton url={account().rootFolderUrl} />
                    <FolderList url={account().rootFolderUrl} />
                  </div>
                  <CheckedOutBranchContext>
                    <Show when={selectionHandle()}>
                      {(sel) => {
                        const selection = makeStateProjection(sel())
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
                  </CheckedOutBranchContext>
                </PackageRegistryContext>
              </SelectionContext>
            )
          }}
        </Show>
      </AccountContext>
    ),
    element,
  )
})
