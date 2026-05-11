import { Show } from "solid-js";
import { Dynamic, render } from "solid-js/web";

import { withDocHandle } from "patchwork-dom";
import { useHandle } from "patchwork-solid";

import { findCompatibleComponent } from "./find-compatible-component";

export default withDocHandle(({ element, handle }) => {
  // Custom elements default to `display: inline` with no size, which
  // collapses any plugin component (R3F canvas, codemirror, etc.) to
  // zero height. Make the host fill its parent.
  element.style.display = "block";
  element.style.width = "100%";
  element.style.height = "100%";

  const tagHandle = findCompatibleComponent(element, handle);
  const url = element.getAttribute("url") ?? undefined;

  return render(() => {
    const tag = useHandle(tagHandle);
    return (
      <Show when={tag()} fallback={<EmptyState />}>
        {(t) => <Dynamic component={t()} url={url} />}
      </Show>
    );
  }, element);
})

function EmptyState() {
  return (
    <div>
      <em>No component matches this document.</em>
    </div>
  );
}
