import { Show } from "https://esm.sh/solid-js@1.9.5";
import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

// ─── Sibling package URLs ───────────────────────────────────────────────
//
// After `pnpm push packages` runs, copy `rootDirectoryUrl` from each
// `packages/<name>/.pushwork/snapshot.json` into the matching constant
// below and re-run `pnpm push packages`. The URLs stay stable across
// subsequent pushes because pushwork preserves each package's
// `rootDirectoryUrl`. The path component of each URL points at the
// package's manifest — by convention `<name>.json`, not `component.json`,
// so the URL self-describes what it loads.
const ROOT_FOLDER_CONTEXT_SRC = "automerge:3fhi2BowJ5TCC1BDq3RF97B7uthB/root-folder-context.json";
const SELECTED_DOC_CONTEXT_SRC = "automerge:3dh4SQH6EBf5ToXiVtAMnu62My5t/selected-doc-context.json";
const CHECKED_OUT_BRANCH_CONTEXT_SRC = "automerge:3r7viUjGF5TLFAMewKBNtg4Yvx4R/checked-out-branch-context.json";
const NEW_MARKDOWN_BUTTON_SRC = "automerge:CM2VRcrcFReYz65Q7xcBV5z84uS/new-markdown-button.json";
const FOLDER_LIST_SRC = "automerge:2WgECNBYQ7ScAysUcQVDeQu6JbLR/folder-list.json";
const DOC_TITLE_SRC = "automerge:3E9kcXgLXrbQgideScbAzDFqcHXt/doc-title.json";
const BRANCH_PICKER_SRC = "automerge:bhg3NCu9QB47N2UGLLMpghY1Dc8/branch-picker.json";
const MARKDOWN_EDITOR_SRC = "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/markdown-editor.json";
const URL_SYNC_SRC = "automerge:quU9eE2Wqih6SLVzS7fAeZJc13c/url-sync.json";

const VERSION = "0.2.0";

// Self-bootstrap: like app-frame.js, root creates its own account doc
// on first run, persists the URL in localStorage, and writes it back
// onto its own `doc=` attribute so the framework rebuilds the view
// with `el.handle` pointing at it. Subsequent loads pick the URL
// straight out of storage.
const STORAGE_KEY = "overlock-patchwork:root:account-url";

export default function (element) {
  const repo = element.repo;
  if (!repo) throw new Error("app-root: el.repo not available");

  // Phase 1: no handle yet. Find-or-create the account doc and stamp
  // our own `doc=` so the registry rebuilds us with `el.handle` set.
  // The rebuild path runs the same mount fn again, falling into
  // Phase 2 below.
  if (!element.handle) {
    element.setAttribute("doc", ensureAccountUrl(repo));
    return;
  }

  const handle = element.handle;
  if (handle.doc()?.["@patchwork"]?.type !== "account") {
    throw new Error("app-root: handle is not an account doc");
  }

  // Wrap the rendered layout in a `<patchwork-context>` carrying the
  // account handle so descendant views (folder list, url-sync, etc.)
  // can walk up and read it. The context's `value` is the handle
  // itself — `DocHandle` doesn't expose a `value` property, so the
  // context stores the input as-is rather than mirroring an upstream.
  const ctx = document.createElement("patchwork-context");
  ctx.source = handle;
  element.appendChild(ctx);

  // Single owner for `selectedDocUrl` writes triggered by descendant
  // intents (folder-list / new-markdown-button click bubbles).
  // url-sync also writes through `hashchange`, but every path
  // converges on the same field.
  const onOpenDocument = (event) => {
    const url = event.detail?.url;
    if (!url) return;
    handle.change((d) => {
      d.selectedDocUrl = url;
    });
  };
  element.addEventListener("patchwork:open-document", onOpenDocument);

  const dispose = render(() => {
    const accountDoc = makeDocumentProjection(handle);
    return Layout({ accountDoc });
  }, ctx);

  return () => {
    element.removeEventListener("patchwork:open-document", onOpenDocument);
    dispose();
    ctx.remove();
  };
}

function ensureAccountUrl(repo) {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const handle = repo.create({ "@patchwork": { type: "account" } });
  localStorage.setItem(STORAGE_KEY, handle.url);
  return handle.url;
}

function Layout({ accountDoc }) {
  return html`
    <style>
      app-root {
        display: flex;
        height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: #1a1a1a;
        background: #fafafa;
      }
      app-root > patchwork-context {
        display: contents;
      }
      app-root > patchwork-context > .sidebar {
        width: 240px;
        flex: 0 0 240px;
        border-right: 1px solid #e3e3e3;
        background: #f3f3f3;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }
      app-root > patchwork-context > .sidebar > .version {
        margin-top: auto;
        padding: 0.5rem 0.75rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        color: #9ca3af;
      }
      app-root > patchwork-context > .content {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      app-root .header {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.75rem;
        background: #fff;
        border-bottom: 1px solid #d4d4d4;
        box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
      }
      app-root .header > doc-title {
        flex: 1 1 auto;
        min-width: 0;
      }
      app-root markdown-editor {
        flex: 1 1 auto;
        display: flex;
        min-height: 0;
      }
      app-root checked-out-branch-context,
      app-root checked-out-branch-context > patchwork-context {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      app-root .empty {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
        font-size: 0.95rem;
      }
    </style>
    <patchwork-view src=${URL_SYNC_SRC}></patchwork-view>
    <aside class="sidebar">
      <patchwork-view src=${ROOT_FOLDER_CONTEXT_SRC}>
        <patchwork-view src=${NEW_MARKDOWN_BUTTON_SRC}></patchwork-view>
        <patchwork-view src=${FOLDER_LIST_SRC}></patchwork-view>
      </patchwork-view>
      <div class="version">v${VERSION}</div>
    </aside>
    <section class="content">
      <${Show}
        when=${() => accountDoc.selectedDocUrl}
        fallback=${html`<div class="empty">No document selected</div>`}
      >
        <patchwork-view src=${SELECTED_DOC_CONTEXT_SRC}>
          <patchwork-view src=${CHECKED_OUT_BRANCH_CONTEXT_SRC}>
            <header class="header">
              <patchwork-view src=${DOC_TITLE_SRC}></patchwork-view>
              <patchwork-view src=${BRANCH_PICKER_SRC}></patchwork-view>
            </header>
            <patchwork-view src=${MARKDOWN_EDITOR_SRC}></patchwork-view>
          </patchwork-view>
        </patchwork-view>
      <//>
    </section>
  `;
}
