import type { AutomergeUrl } from "@automerge/automerge-repo"

import { defineView } from "patchwork-solid"

import type { AccountDoc, FolderDoc } from "./types"

const STORAGE_KEY = "overlock-patchwork:root:account-url"

export default defineView<AccountDoc>(async ({ element, repo }) => {
  let url = localStorage.getItem(STORAGE_KEY) as AutomergeUrl | null
  if (!url) {
    url = repo.create<AccountDoc>({} as AccountDoc).url
    localStorage.setItem(STORAGE_KEY, url)
  }

  const handle = await repo.find<AccountDoc>(url)
  const doc = handle.doc()
  if (!doc.rootFolderUrl) {
    const folder = repo.create<FolderDoc>({ title: "root", docs: [] })
    handle.change((d) => {
      d.rootFolderUrl = folder.url
    })
  }
  if (!doc.packagesFolderUrl) {
    const packages = repo.create<FolderDoc>({ title: "packages", docs: [] })
    handle.change((d) => {
      d.packagesFolderUrl = packages.url
    })
  }

  Object.assign(element, { value: handle, handle, url })
  element.style.display = "contents"
  return undefined
})
