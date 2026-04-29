import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "https://esm.sh/solid-js@1.9.5";
import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { makeDocumentProjection } from "https://esm.sh/@automerge/automerge-repo-solid-primitives@2.5.5?deps=solid-js@1.9.5";

// Pure UI. Reads `el.handle` (the selected doc) and `el.repo` (the
// currently-checked-out `BranchableRepo`, supplied by an enclosing
// `<checked-out-branch-context>`'s inner `<patchwork-context>`),
// renders the dropdown / buttons, and dispatches intent events:
//
//   patchwork:checkout-branch  { detail: { url } }
//   patchwork:fork-branch      { detail: { name } }
//   patchwork:reset-branch     no detail
//
// `<checked-out-branch-context>` is the only element that mutates
// branch state. Reads of the branch-index doc go through `el.repo`:
// pure reads on a `BranchedDocHandle` don't COW, and on the demo's
// off-nested branching there's no risk of an unwanted clone — index
// writes happen in the context element via the parent repo.

export default function (element) {
  const handle = element.handle;
  const repo = element.repo;
  if (!handle || !repo) {
    console.warn("branch-picker: requires el.handle and el.repo");
    return;
  }

  // Snapshot the currently-checked-out branch. `<checked-out-branch-context>`
  // rebuilds this view when it swaps the inner repo, so a fresh
  // snapshot is correct for the lifetime of this mount.
  const currentBranchUrl = repo.branchHandle?.url ?? null;
  const currentBranchName = repo.branchHandle?.doc()?.name ?? null;

  return render(() => Picker(), element);

  function Picker() {
    const doc = makeDocumentProjection(handle);
    const [indexHandle, setIndexHandle] = createSignal(null);

    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    let lastIndexUrl = null;
    createEffect(() => {
      const url = doc["@patchwork"]?.branchIndexUrl ?? null;
      if (url === lastIndexUrl) return;
      lastIndexUrl = url;
      if (!url) {
        setIndexHandle(null);
        return;
      }
      repo.find(url).then((h) => {
        if (cancelled || lastIndexUrl !== url) return;
        setIndexHandle(h);
      });
    });

    const indexDoc = createMemo(() => {
      const h = indexHandle();
      return h ? makeDocumentProjection(h) : null;
    });

    const branchUrls = createMemo(() => indexDoc()?.branches ?? []);

    const [branches, setBranches] = createSignal([]);
    createEffect(() => {
      const urls = [...branchUrls()];
      let alive = true;
      onCleanup(() => {
        alive = false;
      });
      Promise.all(urls.map((u) => repo.find(u))).then((handles) => {
        if (!alive || cancelled) return;
        setBranches(
          handles.map((h) => ({
            url: h.url,
            doc: makeDocumentProjection(h),
          })),
        );
      });
    });

    // Always include the current branch in the options, even before
    // the index doc loads — otherwise no <option> would carry
    // `selected` and the browser would render the first one ("main").
    const branchOptions = createMemo(() => {
      const list = branches().slice();
      if (
        currentBranchUrl &&
        !list.some((b) => b.url === currentBranchUrl)
      ) {
        list.unshift({
          url: currentBranchUrl,
          doc: { name: currentBranchName ?? "Branch" },
        });
      }
      return list;
    });

    const fire = (type, detail) => {
      element.dispatchEvent(
        new CustomEvent(type, {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    };

    const onSelectChange = (event) => {
      const value = event.currentTarget.value;
      if (value === "main") {
        if (currentBranchUrl) fire("patchwork:reset-branch");
      } else if (value !== currentBranchUrl) {
        fire("patchwork:checkout-branch", { url: value });
      }
    };

    const onCreateBranch = () => {
      if (currentBranchUrl) return;
      const name = window.prompt("Branch name?");
      if (!name) return;
      fire("patchwork:fork-branch", { name });
    };

    return html`
      <style>
        branch-picker {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          font: inherit;
          color: #4b5563;
        }
        branch-picker select {
          font: inherit;
          padding: 0.25rem 0.4rem;
          border: 1px solid #d4d4d4;
          border-radius: 4px;
          background: #fff;
          color: inherit;
        }
        branch-picker button {
          font: inherit;
          padding: 0.25rem 0.6rem;
          border: 1px solid #d4d4d4;
          border-radius: 4px;
          background: #fff;
          color: inherit;
          cursor: pointer;
        }
        branch-picker button:hover { background: #f3f4f6; }
      </style>
      <select onChange=${onSelectChange}>
        <option value="main" selected=${!currentBranchUrl}>main</option>
        <${For} each=${branchOptions}>
          ${(b) => html`
            <option value=${() => b.url} selected=${b.url === currentBranchUrl}>
              ${() => b.doc.name ?? "Untitled"}
            </option>
          `}
        <//>
      </select>
      <${Show} when=${() => !currentBranchUrl}>
        <button type="button" onClick=${onCreateBranch}>+ branch</button>
      <//>
    `;
  }
}
