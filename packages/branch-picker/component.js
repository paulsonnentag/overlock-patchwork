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

// Strip a `?heads=…` query so a clone url (which carries the fork-point
// heads) becomes a plain document url that `repo.find` can resolve.
function canonicalUrl(url) {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

export default function (element) {
  const handle = element.handle;
  const repo = element.repo;
  // The enclosing <automerge-repo> is what we mutate to switch / create
  // / merge branches; its `.repo` is the same as `element.repo` here.
  const repoEl = element.closest("automerge-repo");
  if (!handle || !repo || !repoEl) {
    console.warn(
      "branch-picker: requires a doc handle, repo, and <automerge-repo> ancestor",
    );
    return;
  }

  // Branch metadata lives "above" branching: the index doc and the
  // back-pointer on the original doc must be readable/writable from any
  // branch, so we always go through the underlying raw `Repo`. Going
  // through the wrapped repo would COW the index onto whichever branch
  // happens to be checked out.
  const rawRepo = repo.repo;
  // Stable across branching — `BranchedDocHandle.url` always reports the
  // original document url.
  const originalUrl = handle.url;
  // Snapshot the currently checked-out branch. The framework rebuilds
  // this component when `repoEl.checkout/fork/reset` swaps the inner
  // `.repo`, so a fresh snapshot is correct for the lifetime of this
  // mount.
  const currentBranchUrl = repo.branchHandle?.url ?? null;
  const currentBranchName = repo.branchHandle?.doc()?.name ?? null;

  return render(() => Picker(), element);

  function Picker() {
    const doc = makeDocumentProjection(handle);
    const [indexHandle, setIndexHandle] = createSignal(null);

    // Track the lifetime of async finds so a stale resolution can't
    // overwrite a fresher selection or run after unmount.
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
      rawRepo.find(url).then((h) => {
        if (cancelled || lastIndexUrl !== url) return;
        setIndexHandle(h);
      });
    });

    const indexDoc = createMemo(() => {
      const h = indexHandle();
      return h ? makeDocumentProjection(h) : null;
    });

    const branchUrls = createMemo(() => indexDoc()?.branches ?? []);

    // Resolve each branchDoc URL into a {url, doc} pair so the dropdown
    // can render names reactively.
    const [branches, setBranches] = createSignal([]);
    createEffect(() => {
      const urls = [...branchUrls()];
      let alive = true;
      onCleanup(() => {
        alive = false;
      });
      Promise.all(urls.map((u) => rawRepo.find(u))).then((handles) => {
        if (!alive || cancelled) return;
        setBranches(
          handles.map((h) => ({
            url: h.url,
            doc: makeDocumentProjection(h),
          })),
        );
      });
    });

    // Always include the current branch in the options, even before the
    // index doc loads — otherwise the <select> would briefly fall back
    // to "main" while our own branch entry is in flight.
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

    const onSelectChange = async (event) => {
      const value = event.currentTarget.value;
      if (value === "main") {
        if (currentBranchUrl) repoEl.reset();
      } else if (value !== currentBranchUrl) {
        await repoEl.checkout(value);
      }
    };

    const onCreateBranch = async () => {
      if (currentBranchUrl) return;
      const name = window.prompt("Branch name?");
      if (!name) return;

      // Lazily create the branch-index doc and link it from the
      // original doc. After this, every later branch just appends to
      // the existing index.
      let idxHandle = indexHandle();
      if (!idxHandle) {
        idxHandle = rawRepo.create({
          "@patchwork": { type: "branch-index" },
          branches: [],
        });
        const original = await rawRepo.find(originalUrl);
        original.change((d) => {
          if (!d["@patchwork"]) d["@patchwork"] = {};
          d["@patchwork"].branchIndexUrl = idxHandle.url;
        });
      }

      // Fork via the enclosing <automerge-repo> so the swap rebuilds
      // descendants. Eagerly clone the doc so the first edit on the
      // branch is fast.
      const forked = await repoEl.fork({ urls: [originalUrl], name });

      // Record the new branch in the index. By now we've been rebuilt
      // by the framework, but the captured `idxHandle` still writes to
      // the underlying raw repo — the rebuilt picker picks the new
      // entry up via its own subscription.
      idxHandle.change((d) => {
        if (!Array.isArray(d.branches)) d.branches = [];
        d.branches.push(forked.branchHandle.url);
      });
    };

    const onMerge = async () => {
      const branchHandle = repo.branchHandle;
      if (!branchHandle) return;
      const cloneUrlWithHeads = branchHandle.doc()?.clones?.[originalUrl];
      if (!cloneUrlWithHeads) {
        console.warn(
          "branch-picker: branch has no clone for the original doc",
        );
        return;
      }
      // Both handles come from the raw repo so the merge writes go
      // straight to the original document — not through any
      // copy-on-write wrapper.
      const cloneHandle = await rawRepo.find(canonicalUrl(cloneUrlWithHeads));
      const original = await rawRepo.find(originalUrl);
      original.merge(cloneHandle);
      repoEl.reset();
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
      <select
        value=${() => currentBranchUrl ?? "main"}
        onChange=${onSelectChange}
      >
        <option value="main">main</option>
        <${For} each=${branchOptions}>
          ${(b) => html`
            <option value=${() => b.url}>
              ${() => b.doc.name ?? "Untitled"}
            </option>
          `}
        <//>
      </select>
      <${Show} when=${() => !currentBranchUrl}>
        <button type="button" onClick=${onCreateBranch}>+ branch</button>
      <//>
      <${Show} when=${() => currentBranchUrl}>
        <button type="button" onClick=${onMerge}>merge into main</button>
      <//>
    `;
  }
}
