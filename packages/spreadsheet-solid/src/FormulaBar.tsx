import { createEffect, createSignal, type Accessor } from "solid-js";

import { toKey, type Coord } from "./coords";

type FormulaBarProps = {
  active: Accessor<Coord>;
  source: Accessor<string>;
  onCommit: (src: string) => void;
  onFocusChange?: (focused: boolean) => void;
};

export function FormulaBar(props: FormulaBarProps) {
  let inputRef!: HTMLInputElement;
  const [focused, setFocused] = createSignal(false);
  let prevKey = "";

  // Reset the input when (a) the active cell changes — even if focused,
  // since a doc-driven cell switch (e.g. Enter committed and moved down)
  // must show the new cell, and (b) the source changes while we're not
  // focused. While focused, doc round-trips must not fight typing.
  createEffect(() => {
    const key = toKey(props.active());
    const src = props.source();
    if (key !== prevKey || !focused()) {
      if (inputRef) inputRef.value = src;
      prevKey = key;
    }
  });

  return (
    <div class="ss-formula-bar">
      <span class="ss-ref">{toKey(props.active())}</span>
      <input
        ref={inputRef}
        class="ss-formula-input"
        type="text"
        spellcheck={false}
        autocomplete="off"
        onFocus={() => {
          setFocused(true);
          props.onFocusChange?.(true);
        }}
        onBlur={() => {
          setFocused(false);
          props.onFocusChange?.(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onCommit(inputRef.value);
            inputRef.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            inputRef.value = props.source();
            inputRef.blur();
          }
        }}
      />
    </div>
  );
}
