# Data model

The persisted state of a sheet is a flat map keyed by coordinate; all
structure (numbers, references, formulas, errors) is imposed by the
language, not by the data model. Source: [`../src/types.ts`](../src/types.ts),
[`../src/coords.ts`](../src/coords.ts).

```ts
type CellKey = string;                // "A1", "B2", "AA10", …
type Sheet   = Record<CellKey, string>;
```

The flat-map shape is chosen so that two concurrent edits to different
cells merge cleanly under a last-writer-wins map (e.g. an Automerge
`Map<string, string>`).

## Coordinates

Classical spreadsheet convention: one or more uppercase letters for
the column followed by a 1-indexed row number. `A1` is the top-left
cell. Columns extend `A…Z, AA…ZZ, AAA…`. Format:
`^[A-Z]+[1-9][0-9]*$`. `isCellKey` in
[`../src/coords.ts`](../src/coords.ts) is the validator the engine
uses to sanity-check keys returned from `deps()`.

## Cell source

Every cell value is **a string** — the raw source the user typed.
Numbers, references, formulas, errors, and emptiness are all imposed
by the language at parse time, not by the data model.

## Empty cells

An absent key is treated identically to the empty string. The grammar
decides what `""` means. The engine matches `""` against the language
once and caches the result so any cell referenced but never written
still has a defined value (e.g. `0` for the bundled arithmetic
language).

Everything else — parse trees, dependency graphs, computed values,
effect cleanups — is derived and lives in the engine.
