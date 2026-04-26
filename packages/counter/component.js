import { createSignal } from "https://esm.sh/solid-js@1.9.5";
import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";

function Counter() {
  const [count, setCount] = createSignal(0);
  return html`
    <button type="button" onClick=${() => setCount(count() + 1)}>
      count: ${count}
    </button>
  `;
}

export default async function (element) {
  return render(() => Counter(), element);
}
