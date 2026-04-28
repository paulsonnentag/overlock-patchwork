# Design notes

Documents in this folder describe **planned or exploratory work**, not
the current behavior of the system. They sit alongside `docs/` to keep
the line between "this is how it works today" and "this is how we
think we'd like it to work" clear.

The architecture docs in `docs/*.md` are the source of truth for
*intended* current behavior — if code disagrees with them it's a bug
to fix. The notes in here are the opposite: a snapshot of thinking
that the code does *not* implement yet. Treat them as drafts; they
may be wrong, partially superseded, or quietly abandoned.

When a design lands, the implementing PR should:

- Update the relevant `docs/*.md` files to describe the new behavior.
- Either delete the design note or rewrite it as a "history /
  rationale" pointer from the architecture doc.

## Index

- [`reactivity.md`](./reactivity.md) — `el.handle` and `el.repo` are
  currently snapshots stamped at mount time. This note characterizes
  where that staleness shows up and sketches a `Subscribable<T>`-based
  API plus a Solid integration layer.
