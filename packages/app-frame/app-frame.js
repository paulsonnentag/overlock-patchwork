import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";

// ─── Sibling package URL ────────────────────────────────────────────────
//
// After `pnpm push packages` runs, copy `rootDirectoryUrl` from
// `packages/root/.pushwork/snapshot.json` into the constant below and
// re-run `pnpm push packages`. The URL stays stable across subsequent
// pushes because pushwork preserves the package's `rootDirectoryUrl`.
const ROOT_SRC = "automerge:3t8ivUxWittXbhnmz5ZLVCMPqxJC/root.json";

const STORAGE_KEY = "overlock-patchwork:app-frame:account-url";

function newAccount() {
  return { "@patchwork": { type: "account" } };
}

function newRootFolder() {
  return { "@patchwork": { type: "folder" }, title: "Documents", docs: [] };
}

function ensureAccountUrl(repo) {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const handle = repo.create(newAccount());
  localStorage.setItem(STORAGE_KEY, handle.url);
  return handle.url;
}

function ensureRootFolder(repo, accountHandle) {
  const doc = accountHandle.doc();
  if (doc?.rootFolderUrl) return;
  const folder = repo.create(newRootFolder());
  accountHandle.change((d) => {
    if (!d.rootFolderUrl) d.rootFolderUrl = folder.url;
  });
}

export default async function (element) {
  const repo = element.repo;
  if (!repo) {
    throw new Error("app-frame requires an <automerge-repo> ancestor");
  }

  // Phase 1: no handle yet. Find-or-create the account doc and stamp our
  // own doc= so the registry rebuilds us with el.handle on the account.
  // The rebuild path runs the same mount fn again, which falls into the
  // Phase 2 branch below.
  if (!element.handle) {
    const accountUrl = ensureAccountUrl(repo);
    element.setAttribute("doc", accountUrl);
    return;
  }

  // Phase 2: el.handle is the account doc.
  ensureRootFolder(repo, element.handle);

  const onOpenDocument = (event) => {
    event.stopPropagation();
    const url = event.detail?.url;
    if (!url) return;
    if (element.handle.doc()?.selectedDocUrl === url) return;
    element.handle.change((d) => {
      d.selectedDocUrl = url;
    });
  };
  element.addEventListener("patchwork:open-document", onOpenDocument);

  const dispose = render(
    () => html`<patchwork-view src=${ROOT_SRC}></patchwork-view>`,
    element,
  );

  return () => {
    element.removeEventListener("patchwork:open-document", onOpenDocument);
    dispose();
  };
}
