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
// `rootDirectoryUrl`.
const ROOT_FOLDER_CONTEXT_SRC = "automerge:3fhi2BowJ5TCC1BDq3RF97B7uthB/component.json";
const SELECTED_DOC_CONTEXT_SRC = "automerge:3dh4SQH6EBf5ToXiVtAMnu62My5t/component.json";
const CHECKED_OUT_BRANCH_CONTEXT_SRC = "automerge:3r7viUjGF5TLFAMewKBNtg4Yvx4R/component.json";
const NEW_MARKDOWN_BUTTON_SRC = "automerge:CM2VRcrcFReYz65Q7xcBV5z84uS/component.json";
const FOLDER_LIST_SRC = "automerge:2WgECNBYQ7ScAysUcQVDeQu6JbLR/component.json";
const DOC_TITLE_SRC = "automerge:3E9kcXgLXrbQgideScbAzDFqcHXt/component.json";
const BRANCH_PICKER_SRC = "automerge:bhg3NCu9QB47N2UGLLMpghY1Dc8/component.json";
const MARKDOWN_EDITOR_SRC = "automerge:ktem5LsqihaRgoZbz9SXQ9uJ5J4/component.json";
const URL_SYNC_SRC = "automerge:quU9eE2Wqih6SLVzS7fAeZJc13c/component.json";

const VERSION = "0.1.4";

const accountSchema = {
  init: () => ({ "@patchwork": { type: "account" } }),
  parse: (value) => {
    if (!value || typeof value !== "object") {
      throw new Error("app-root: not an account doc");
    }
    if (value["@patchwork"]?.type !== "account") {
      throw new Error("app-root: doc is not type=account");
    }
    return value;
  },
};

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
      app-root > .sidebar {
        width: 240px;
        flex: 0 0 240px;
        border-right: 1px solid #e3e3e3;
        background: #f3f3f3;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }
      app-root > .sidebar > .version {
        margin-top: auto;
        padding: 0.5rem 0.75rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        color: #9ca3af;
      }
      app-root > .content {
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
      app-root checked-out-branch-context {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      app-root > .content > .empty {
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

export default function (element) {
  const account = element.closestView(accountSchema).value();
  if (!account) {
    throw new Error("app-root requires an account ancestor (typically <app-frame>)");
  }
  const accountDoc = makeDocumentProjection(account.handle);
  return render(() => Layout({ accountDoc }), element);
}
