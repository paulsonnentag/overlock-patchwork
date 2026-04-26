import { createSignal, onCleanup } from "https://esm.sh/solid-js@1.9.5";
import { render } from "https://esm.sh/solid-js@1.9.5/web";
import html from "https://esm.sh/solid-js@1.9.5/html";

function Clock() {
  const [now, setNow] = createSignal(new Date());
  const interval = setInterval(() => setNow(new Date()), 1000);
  onCleanup(() => clearInterval(interval));
  return html`<span>${() => now().toLocaleTimeString()} 🕒</span>`;
}

export default async function (element) {
  return render(() => Clock(), element);
}
