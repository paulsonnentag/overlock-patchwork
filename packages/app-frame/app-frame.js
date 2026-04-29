import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

const STORAGE_KEY = "overlock-patchwork:app-frame:counter-url";

function ensureCounterUrl(repo) {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const handle = repo.create({ count: 0 });
  localStorage.setItem(STORAGE_KEY, handle.url);
  return handle.url;
}

export default async function (element) {
  const repo = element.repo;
  if (!repo) throw new Error("app-frame: window.repo not available");

  // Phase 1: no handle yet. Find-or-create the counter doc and stamp
  // our own doc= so the registry rebuilds us with el.handle on it. The
  // rebuild path runs the same mount fn again, which falls into the
  // Phase 2 branch below.
  if (!element.handle) {
    element.setAttribute("doc", ensureCounterUrl(repo));
    return;
  }

  const handle = element.handle;
  const doc = makeDocumentProjection(handle);

  return render(
    () => html`
      <button
        type="button"
        onClick=${() =>
          handle.change((d) => {
            d.count = (d.count ?? 0) + 1;
          })}
      >
        count: ${() => doc.count ?? 0}
      </button>
    `,
    element,
  );
}
