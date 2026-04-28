import { describe, expect, it } from "vitest";

import { Scope, type Handle, type Schema } from "./scope";
import { BasicSubscribable } from "./subscribable";

const counterSchema: Schema<{ kind: "counter"; count: number }> = {
  parse: (v) => {
    if (
      v === null ||
      typeof v !== "object" ||
      (v as { kind?: unknown }).kind !== "counter"
    ) {
      throw new Error("not a counter");
    }
    return v as { kind: "counter"; count: number };
  },
};

const labelSchema: Schema<{ label: string }> = {
  parse: (v) => {
    if (
      v === null ||
      typeof v !== "object" ||
      typeof (v as { label?: unknown }).label !== "string"
    ) {
      throw new Error("not labelled");
    }
    return v as { label: string };
  },
};

// `BasicSubscribable<unknown>` already satisfies the `Handle` interface
// — `value()`, `change(next)`, `subscribe(fn)` — so the experiment
// reuses its own primitive end to end. These helpers just make the
// tests read like document constructors.
function counter(count: number): Handle {
  return new BasicSubscribable<unknown>({ kind: "counter", count });
}

function labelled(label: string): Handle {
  return new BasicSubscribable<unknown>({ label });
}

describe("Scope", () => {
  // Subscribers see ancestor changes without re-walking. A closer
  // ancestor that gains a match shadows a further one; flipping the
  // closer one off falls back to the further match. `handle.change()`
  // and `handle =` are the two paths into a flip; both go through the
  // same per-scope subscribe wiring.
  it("closest tracks the nearest matching ancestor across handle flips", () => {
    const root = new Scope();
    const aHandle = counter(1);
    const a = root.create(aHandle);
    const b = a.create();
    const c = b.create();

    const seen: Array<Scope | null> = [];
    c.closest(counterSchema).subscribe((s) => seen.push(s));
    expect(seen).toEqual([a]);

    // A closer match (`b`) shadows the further one (`a`). This time
    // the flip is via the `handle` setter rather than `change()`.
    const bHandle = counter(2);
    b.handle = bHandle;
    expect(seen).toEqual([a, b]);

    // `b.handle.change(non-counter)` → b stops matching → fall back to a.
    bHandle.change({ label: "hello" });
    expect(seen).toEqual([a, b, a]);

    // `a` stops matching too → no ancestor matches.
    aHandle.change(null);
    expect(seen).toEqual([a, b, a, null]);

    // Detaching `b`'s handle entirely takes b out of the registry.
    // (Already a non-matcher, so nothing changes here — exercises the
    // "set handle to null" path without expecting a flip.)
    b.handle = null;
    expect(seen).toEqual([a, b, a, null]);

    // Re-introduce a counter on `a`: c's closest sees it again.
    aHandle.change({ kind: "counter", count: 99 });
    expect(seen).toEqual([a, b, a, null, a]);
  });

  // findAll is the "all data in scope" view. Both kinds of mutation —
  // structural (create, remove, moveTo) and content (handle.change)
  // — must show up at a single subscribed view, in DOM-like pre-order.
  it("findAll aggregates structural and handle.change mutations", () => {
    const root = new Scope();
    const a = root.create();
    const b = root.create();
    const a1 = a.create(labelled("a1")); // pre-existing match
    const a2 = a.create();

    const seen: Array<readonly Scope[]> = [];
    root.findAll(labelSchema).subscribe((list) => seen.push([...list]));

    // Initial snapshot reflects pre-subscribe handle state via lazy
    // schema registration + back-fill.
    expect(seen).toEqual([[a1]]);

    // Attach a handle to a previously-empty scope.
    a2.handle = labelled("a2");
    expect(seen).toEqual([[a1], [a1, a2]]);

    // Sibling-of-`a` flipping in: ordering follows tree pre-order, so
    // `b` lands after `a`'s descendants.
    b.handle = labelled("b");
    expect(seen).toEqual([[a1], [a1, a2], [a1, a2, b]]);

    // Detach `a`'s subtree → both `a1` and `a2` leave at once. `a`
    // itself never matched, but its descendants did.
    a.remove();
    expect(seen).toEqual([[a1], [a1, a2], [a1, a2, b], [b]]);

    // Re-attach `a` under `b` → set re-grows. `b` is matched first,
    // then we descend through `a` (no match) into its children.
    a.moveTo(b);
    expect(seen).toEqual([[a1], [a1, a2], [a1, a2, b], [b], [b, a1, a2]]);
  });

  // The `handle` setter is the only path into the per-scope subscribe
  // wiring. It has to (a) unsubscribe the old handle, (b) subscribe
  // the new one (which fires synchronously with current value), (c)
  // dedup repeated change()s that don't flip the schema verdict, and
  // (d) ignore further `change()`s on a detached handle.
  it("the handle setter (re)wires subscribe and change paths", () => {
    const root = new Scope();
    const child = root.create();

    const seen: Array<Scope | null> = [];
    child.closest(labelSchema).subscribe((s) => seen.push(s));
    expect(seen).toEqual([null]);

    // Attach a matching handle.
    const h1 = labelled("first");
    child.handle = h1;
    expect(seen).toEqual([null, child]);

    // change() that keeps the verdict matching — leaf dedup absorbs.
    h1.change({ label: "renamed" });
    expect(seen).toEqual([null, child]);

    // change() that flips the verdict to non-match.
    h1.change(null);
    expect(seen).toEqual([null, child, null]);

    // Replace with another handle that does match.
    const h2 = labelled("second");
    child.handle = h2;
    expect(seen).toEqual([null, child, null, child]);

    // The detached old handle no longer affects the scope — we
    // unsubscribed during the swap.
    h1.change({ label: "ghost" });
    expect(seen).toEqual([null, child, null, child]);

    // Set to null → unsubscribe + clear matches.
    child.handle = null;
    expect(seen).toEqual([null, child, null, child, null]);

    // h2's subsequent change is also ignored (we unsubscribed).
    h2.change({ label: "still ghost" });
    expect(seen).toEqual([null, child, null, child, null]);
  });
});
