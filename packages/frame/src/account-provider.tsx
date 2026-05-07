import type { AutomergeUrl } from "@automerge/automerge-repo"

import { getRepo } from "patchwork-dom"

import type { AccountDoc, FolderDoc } from "./types"

const STORAGE_KEY = "overlock-patchwork:root:account-url"

export default async (element: HTMLElement) => {
  const repo = getRepo(element)
  let url = localStorage.getItem(STORAGE_KEY) as AutomergeUrl | null
  if (!url) {
    const rootFolder = repo.create<FolderDoc>({ title: "root", docs: [] })
    const packagesFolder = repo.create<FolderDoc>({
      title: "packages",
      docs: [],
    })
    const account = repo.create<AccountDoc>({
      rootFolderUrl: rootFolder.url,
      packagesFolderUrl: packagesFolder.url,
    })
    url = account.url
    localStorage.setItem(STORAGE_KEY, url)
  }

  const handle = await repo.find<AccountDoc>(url)
  Object.assign(element, { handle })
  element.style.display = "contents"
}
