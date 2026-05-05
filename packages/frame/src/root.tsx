import { Show, createSignal } from "solid-js"
import { render } from "solid-js/web"

import type { DocHandle } from "@automerge/automerge-repo"

import {
  defineView,
  makeDocumentProjection,
  type ViewElement,
} from "patchwork-solid"

import "./styles.css"

import type { AccountDoc } from "./types"

const FRAME_PKG = "automerge:3t8ivUxWittXbhnmz5ZLVCMPqxJC/dist"
const MD_PKG = "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/dist"

const ACCOUNT_CONTEXT_SRC = `${FRAME_PKG}/account-context.json`
const SELECTION_CONTEXT_SRC = `${FRAME_PKG}/document-selection-context.json`
const SELECTION_URL_SYNC_SRC = `${FRAME_PKG}/document-selection-url-sync.json`
const FOLDER_LIST_SRC = `${FRAME_PKG}/folder-list.json`
const SINGLE_VIEW_SRC = `${FRAME_PKG}/single-view.json`
const NEW_MARKDOWN_BUTTON_SRC = `${MD_PKG}/new-markdown-button.json`

export default defineView(({ element, registerView }) => {
  const AccountContext = registerView<AccountDoc>(ACCOUNT_CONTEXT_SRC)
  const SelectionContext = registerView(SELECTION_CONTEXT_SRC)
  const SelectionUrlSync = registerView(SELECTION_URL_SYNC_SRC)
  const FolderList = registerView(FOLDER_LIST_SRC)
  const SingleView = registerView(SINGLE_VIEW_SRC)
  const NewMarkdownButton = registerView(NEW_MARKDOWN_BUTTON_SRC)

  // Hold the raw handle and project inside the Show's render scope so
  // makeDocumentProjection's onCleanup runs in a tracked Solid context.
  const [accountHandle, setAccountHandle] =
    createSignal<DocHandle<AccountDoc>>()

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
              <SelectionContext>
                <SelectionUrlSync />
                <div class="frame__sidebar">
                  <NewMarkdownButton url={account().rootFolderUrl} />
                  <FolderList url={account().rootFolderUrl} />
                </div>
                <SingleView />
              </SelectionContext>
            )
          }}
        </Show>
      </AccountContext>
    ),
    element,
  )
})
