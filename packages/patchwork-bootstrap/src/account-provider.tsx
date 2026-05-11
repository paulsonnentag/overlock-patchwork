import type { AutomergeUrl } from "@automerge/automerge-repo";

import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { getRepo } from "patchwork-dom";

import type { AccountDoc } from "./types";

const STORAGE_KEY = "overlock-patchwork:root:account-url";
const PACKAGES_FOLDER_URL = "automerge:mExaJTQKBs6CHpzZtZYYzc2YDXr";

const DEFAULT_FRAME_URL =
  "automerge:2beoANHD3SCwKVs5EwktStnU8qYn/dist/patchwork-frame-component.json";

export default async (element: HTMLElement) => {
  const repo = getRepo(element);
  let url = localStorage.getItem(STORAGE_KEY) as AutomergeUrl | null;
  if (!url) {
    const rootFolder = repo.create<FolderDoc>({ title: "root", docs: [] });
    const account = repo.create<AccountDoc>({
      rootFolderUrl: rootFolder.url,
      packagesFolderUrl: PACKAGES_FOLDER_URL as AutomergeUrl,
      frameUrl: DEFAULT_FRAME_URL as AutomergeUrl,
    });
    url = account.url;
    localStorage.setItem(STORAGE_KEY, url);
  }

  const handle = await repo.find<AccountDoc>(url);
  Object.assign(element, { handle });
  element.style.display = "contents";
};
