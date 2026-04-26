import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";

const COUNTER_SRC = "automerge:4NdChAJ19xmag7Ae5sBnShBUq95i/component.json";
const CLOCK_SRC = "automerge:2Xa2AQP4fg2MfuKc47pn7RmT6ZDB/component.json";

function App() {
  return html`
    <h1>demo</h1>
    <patchwork-view src="${COUNTER_SRC}"></patchwork-view>
    <patchwork-view src="${CLOCK_SRC}"></patchwork-view>
  `;
}

export default async function (element) {
  return render(() => App(), element);
}
