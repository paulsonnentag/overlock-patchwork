import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";

const COUNTER_SRC = "automerge:4NdChAJ19xmag7Ae5sBnShBUq95i/component.json";
const CLOCK_SRC = "automerge:2Xa2AQP4fg2MfuKc47pn7RmT6ZDB/component.json";

const STORAGE_KEY = "demo-app:counter-doc-url";

function ensureCounterDocUrl(repo) {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const handle = repo.create({ count: 0 });
  localStorage.setItem(STORAGE_KEY, handle.url);
  return handle.url;
}

function App({ counterUrl }) {
  return html`
    <h1>demo</h1>
    <patchwork-view doc="${counterUrl}" src="${COUNTER_SRC}"></patchwork-view>
    <patchwork-view src="${CLOCK_SRC}"></patchwork-view>
  `;
}

export default async function (element) {
  const repo = element.closest("automerge-repo")?.repo;
  if (!repo) {
    throw new Error("demo-app requires an <automerge-repo> ancestor");
  }
  const counterUrl = ensureCounterDocUrl(repo);
  return render(() => App({ counterUrl }), element);
}
