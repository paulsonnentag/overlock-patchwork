import { Show } from "solid-js";
import { Dynamic, render } from "solid-js/web";

import { withDocHandle } from "patchwork-dom";
import { useHandle } from "patchwork-solid";

import { pickComponentForDoc } from "./pick-component-for-doc";

export default withDocHandle(({ element }) => {
  const abort = new AbortController();
  const tagHandle = pickComponentForDoc(element, abort.signal);
  const url = element.getAttribute("url") ?? undefined;

  const dispose = render(() => {
    const tag = useHandle(tagHandle);
    return (
      <Show when={tag()} fallback={<EmptyState />}>
        {(t) => <Dynamic component={t()} url={url} />}
      </Show>
    );
  }, element);

  return () => {
    abort.abort();
    dispose();
  };
});

function EmptyState() {
  return (
    <div>
      <em>No component matches this document.</em>
    </div>
  );
}
