import type { Accessor } from "solid-js";

import type { CellState } from "spreadsheet";

type CellProps<V> = {
  row: number;
  col: number;
  rowH: number;
  colW: number;
  state: Accessor<CellState<V>>;
  format: (s: CellState<V>) => string;
  selected: boolean;
  active: boolean;
};

export function Cell<V>(props: CellProps<V>) {
  return (
    <div
      class="ss-cell"
      classList={{
        "ss-cell-selected": props.selected,
        "ss-cell-active": props.active,
        "ss-cell-cycle": props.state().status === "cycle",
        "ss-cell-pending": props.state().status === "pending",
      }}
      data-row={props.row}
      data-col={props.col}
      style={{
        left: `${props.col * props.colW}px`,
        top: `${props.row * props.rowH}px`,
        width: `${props.colW}px`,
        height: `${props.rowH}px`,
      }}
      title={titleFor(props.state())}
    >
      {props.format(props.state())}
    </div>
  );
}

function titleFor<V>(s: CellState<V>): string | undefined {
  if (s.status === "cycle") return s.cycle.join(" → ");
  return undefined;
}
