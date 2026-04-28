import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

const STORAGE_KEY = "overlock-patchwork:root:counter-url";

function newCounter() {
  return { count: 0 };
}

function ensureCounterUrl(repo) {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const handle = repo.create(newCounter());
  localStorage.setItem(STORAGE_KEY, handle.url);
  return handle.url;
}

function Counter({ handle, doc }) {
  return html`
    <style>
      app-root {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      app-root button {
        padding: 0.6rem 1.2rem;
        font-size: 1rem;
        border-radius: 6px;
        border: 1px solid #d4d4d4;
        background: #fff;
        cursor: pointer;
      }
    </style>
    <button
      type="button"
      onClick=${() => handle.change((d) => { d.count = (d.count ?? 0) + 1; })}
    >
      count: ${() => doc.count ?? 0}
    </button>
  `;
}

export default async function (element) {
  const repo = element.repo;
  if (!repo) {
    throw new Error("app-root requires an <automerge-repo> ancestor");
  }

  // Phase 1: no handle yet. Find-or-create the counter doc and stamp our
  // own doc= so the registry rebuilds us with el.handle on the counter.
  // The rebuild path runs the same mount fn again, which falls into
  // Phase 2 below.
  if (!element.handle) {
    const counterUrl = ensureCounterUrl(repo);
    element.setAttribute("doc", counterUrl);
    return;
  }

  // Phase 2: el.handle is the counter doc.
  const handle = element.handle;
  const doc = makeDocumentProjection(handle);
  return render(() => Counter({ handle, doc }), element);
}
