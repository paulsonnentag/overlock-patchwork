import type { AutomergeUrl } from "@automerge/automerge-repo"

import { defineView } from "patchwork-solid"

import type { AccountDoc, FolderDoc } from "./types"

const STORAGE_KEY = "overlock-patchwork:root:account-url"

export default defineView<AccountDoc>(async ({ element, repo }) => {
  let url = localStorage.getItem(STORAGE_KEY) as AutomergeUrl | null
  if (!url) {
    const folder = repo.create<FolderDoc>({ title: "root", docs: [] })
    const account = repo.create<AccountDoc>({ rootFolderUrl: folder.url })
    url = account.url
    localStorage.setItem(STORAGE_KEY, url)
  }

  const handle = await repo.find<AccountDoc>(url)
  Object.assign(element, { value: handle, handle, url })
  element.style.display = "contents"
  return undefined
})
