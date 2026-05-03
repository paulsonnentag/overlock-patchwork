# UI

A Solid view that pairs an Automerge `Sheet` doc with an
`Engine<V>` and renders a virtualized grid. Engine-agnostic: the view
reads through `Engine.get`, writes through `setCell` / `deleteCell`,
and is told how to display `V` via a `format` prop. Source lives in a
sibling package, [`../../spreadsheet-solid/src/`](../../spreadsheet-solid/src/).

```ts
type SpreadsheetProps<V> = {
  handle: DocHandle<Sheet>;
  language: SpreadsheetLanguage<V>;
  format?: (state: CellState<V>) => string;
};
```

The component takes a handle, not a URL — the rest of patchwork passes
handles around (`el.handle`, `Handle<T>` in
[`../../../src/handle.ts`](../../../src/handle.ts)), so callers
already have one. Resolving from a URL is the caller's job
(`useDocHandle`, `el.handle`, etc).

The component owns one engine per mount; the doc is the durable seam.
Two effects keep the seams in sync — doc → engine and engine → DOM —
and writes always land on the doc, never on the engine directly.

## File map

- [`Spreadsheet.tsx`](../../spreadsheet-solid/src/Spreadsheet.tsx) —
  top-level component; owns engine, selection, edit mode.
- [`coords.ts`](../../spreadsheet-solid/src/coords.ts) —
  `(row, col) ↔ "A1"` helpers.
- [`sheetSync.ts`](../../spreadsheet-solid/src/sheetSync.ts) — doc →
  engine bridge.
- [`engineSignal.ts`](../../spreadsheet-solid/src/engineSignal.ts) —
  engine → Solid bridge (per-cell signals).
- [`selection.ts`](../../spreadsheet-solid/src/selection.ts) —
  selection rectangle + utilities.
- [`clipboard.ts`](../../spreadsheet-solid/src/clipboard.ts) — TSV
  serialize / parse.
- [`grid/Grid.tsx`](../../spreadsheet-solid/src/grid/Grid.tsx) —
  virtual grid, scroll, mouse.
- [`grid/Cell.tsx`](../../spreadsheet-solid/src/grid/Cell.tsx) —
  single cell render.
- [`FormulaBar.tsx`](../../spreadsheet-solid/src/FormulaBar.tsx) —
  input bar above the grid.

## Source of truth

The Automerge doc holds a `Sheet` (`Record<CellKey, string>`); the
engine is a derived computation cache. All writes go to the doc:

- absent key ⇔ empty cell ⇔ `delete d[k]` — keeps the map sparse and
  merges cleanly under last-writer-wins; see
  [`data-model.md`](./data-model.md).
- multi-cell writes (clear, paste, fill) go in a single
  `handle.change` so peers see them as one merge unit.

## Doc → engine

Automerge already computes per-key patches; no diffing on our side.
On mount, walk `Object.entries(doc)` once to seed the engine. After
that, listen on `handle.on("change", { patches })`: every patch at
`path.length === 1` is either `put` → `setCell(path[0], doc[path[0]])`
or `del` → `deleteCell(path[0])`. The engine's per-key idempotence
means a redundant `setCell` is free, so we don't need to be clever
about which patches to skip.

## Engine → DOM

A lazy `Map<CellKey, Signal<CellState<V>>>`. The engine's
`subscribe(changed)` callback is the only writer. Cells read through
the signal, so only the cells whose state actually changed re-render —
even though `Cell.tsx` itself doesn't know which cells changed. See
[`engine.md`](./engine.md) for what `changed` covers (every state
transition, including `pending` ↔ `ok` ↔ `cycle`).

## Geometry

Cells are stored under A1-style `CellKey`s — the engine, language,
and doc all share that keying, so the UI only converts
`(row, col) ↔ "A1"` at the geometric boundary (visible-range math,
cell positioning). Column headers render `toLetters(col)`; row
headers render `row + 1`. Storing numeric coords would force a
conversion on every doc write and every `engine.subscribe`
notification, with no offsetting win.

Fixed `ROW_H` and `COL_W`. The scroller's inner spacer is sized
`rows * ROW_H × cols * COL_W`; visible range is derived from
`scrollTop` / `scrollLeft` plus a small overscan. "Infinite" scroll
extends `rows` / `cols` when the user nears the edge — no
`IntersectionObserver`, just a threshold check on scroll. Initial
extent is `max(viewport-fits, last-occupied-row + buffer)` so opening
a doc shows the data plus a margin of empty rows; no `initialRows` /
`initialCols` props. Headers are sticky divs inside the same
scroller, not a separate scrollable region.

## Selection

```ts
type Selection = { anchor: Coord; head: Coord };
```

`head` is the active cell — it owns formula-bar focus, keyboard input,
and is the origin for paste. Mouse: `mousedown` collapses to a single
cell, drag updates `head`, shift-click sets `head` only. Keyboard:
arrows move `head` and collapse, `shift+arrows` move `head` only. Any
keyboard or mouse motion that moves `head` off-screen scrolls the
viewport just enough to bring it back into view; a drag whose pointer
sits near the viewport edge auto-scrolls the same way.

The grid binds `mousedown` once at the container; cells carry
`data-row` / `data-col` and the handler reads them off `event.target`.

Only one selection rectangle. Multi-range (`Ctrl+click` to add a
second rectangle) is out of scope.

## Editing

Two edit sites — formula bar and in-cell — share one source of truth:
`handle.change(d => d[key] = src)`. Edit modes:

- `idle` — selection / navigation.
- `editing-cell` — overlay `<input>` over the active cell.
- `editing-bar` — focus is in the formula bar.

`Enter` / `Tab` commit and move (`down` / `right`); `Escape` cancels.
A printable character from `idle` enters `editing-cell` and replaces
the source. Inputs are uncontrolled while focused, then reset to the
doc value when the active cell changes — a doc round-trip must not
fight the user's keystrokes.

## Clipboard

TSV in both directions, matching Sheets / Excel: rows separated by
`\n`, cells by `\t`. Copy serializes the doc (raw source — formulas
verbatim); paste writes the parsed cells starting at `head` and
expands the selection to cover the pasted rectangle.

Use the browser's native `copy` / `cut` / `paste` events on the grid
root (`tabindex="0"`, focused whenever no editor is open):
`event.clipboardData.setData("text/plain", tsv)` and `preventDefault()`
on copy; `event.clipboardData.getData("text/plain")` on paste. This
is what handsontable does (modulo a hidden textarea wrapper for
old-browser compat we don't need); it avoids `navigator.clipboard`
permissions, fires for OS-menu Copy/Paste, and gives `clipboardData`
synchronously. Cut is copy plus clear-selection in one
`handle.change`.

## Rendering cell state

`format(state: CellState<V>) => string` is the only place the UI
looks at `V`. Default formatter:

- `pending` → `"…"`.
- `cycle` → `"#CYCLE!"`, with `cycle.join(" → ")` as a tooltip.
- `ok` → coercion: numbers as-is, strings as-is, objects via
  `JSON.stringify`.

A language with structured errors carries them inside `V` and supplies
its own `format`; the engine still has no error channel.

## Boundaries

Things explicitly **not** in scope, mirroring the engine's restraint:

- Syntax highlighting in the formula bar or inline.
- Frozen panes, custom row / column sizes, cell merging.
- Undo / redo. (Automerge has the history; no UI for it here.)
- Range selections in formulas (`A1:B3`) — the engine doesn't
  understand them and the language can't ask for them.
- Optimization beyond the per-cell signal — single-`change` write
  batching is already cheap enough for thousands of visible cells.
