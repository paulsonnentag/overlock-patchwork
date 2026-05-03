import {
  isValidAutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";

import { BranchableRepo } from "./branchable-repo";

export type ViewElement<V = unknown> = HTMLElement & {
  handle?: DocHandle<V>;
  repo: BranchableRepo;
  context: <T>(predicate: (value: unknown) => value is T) => T | null;
};

export type MountFn = (
  element: ViewElement,
) => Promise<(() => void) | void> | ((() => void) | void);

type ViewState = {
  mounted: Promise<void>;
  cleanup: (() => void) | null;
};

const views = new WeakMap<Element, ViewState>();

export function mountView(el: HTMLElement, mountFn: MountFn): Promise<void> {
  const existing = views.get(el);
  if (existing) return existing.mounted;
  const state: ViewState = { mounted: undefined!, cleanup: null };
  views.set(el, state);
  state.mounted = mount(el, mountFn);
  return state.mounted;
}

export function unmountView(el: Element): void {
  const state = views.get(el);
  if (!state) return;
  views.delete(el);
  if (state.cleanup) runCleanup(state.cleanup);
}

export function isView(el: Element): boolean {
  return views.has(el);
}

export function viewMounted(el: Element): Promise<void> | null {
  return views.get(el)?.mounted ?? null;
}

async function mount(el: HTMLElement, mountFn: MountFn): Promise<void> {
  const ancestor = findAncestorMounted(el);
  if (ancestor) {
    try {
      await ancestor;
    } catch {
      views.delete(el);
      return;
    }
  }
  if (!el.isConnected) {
    views.delete(el);
    return;
  }

  const viewEl = el as ViewElement;
  viewEl.context = <T>(predicate: (v: unknown) => v is T): T | null =>
    walkContexts(el, predicate);
  viewEl.repo = resolveRepo(viewEl);

  try {
    await resolveContext(el);
  } catch (err) {
    console.error("[overlock-patchwork] doc context resolution failed:", err);
    throw err;
  }
  if (!el.isConnected) {
    views.delete(el);
    return;
  }

  let result: (() => void) | void;
  try {
    result = await mountFn(el as ViewElement);
  } catch (err) {
    console.error(
      `[overlock-patchwork] mount threw on <${el.localName}>:`,
      err,
    );
    throw err;
  }

  const cleanup = typeof result === "function" ? result : null;
  if (!el.isConnected) {
    if (cleanup) runCleanup(cleanup);
    views.delete(el);
    return;
  }
  const state = views.get(el);
  if (state) state.cleanup = cleanup;
}

function findAncestorMounted(el: HTMLElement): Promise<void> | null {
  let cur = el.parentElement;
  while (cur) {
    const state = views.get(cur);
    if (state) return state.mounted;
    cur = cur.parentElement;
  }
  return null;
}

async function resolveContext(el: HTMLElement): Promise<void> {
  const docUrl = el.getAttribute("doc");
  if (!docUrl) return;

  if (!isValidAutomergeUrl(docUrl)) {
    throw new Error(
      `[overlock-patchwork] doc attribute is not a valid automerge URL: "${docUrl}"`,
    );
  }

  const handle = await (el as ViewElement).repo.find(docUrl);
  (el as ViewElement).handle = handle as DocHandle<unknown>;
}

function walkContexts<T>(
  start: Element,
  predicate: (value: unknown) => value is T,
): T | null {
  let cur: Element | null = start.parentElement;
  while (cur) {
    if (cur.localName.includes("-") && "value" in cur) {
      const v = (cur as Element & { value: unknown }).value;
      if (predicate(v)) return v;
    }
    cur = cur.parentElement;
  }
  return null;
}

function resolveRepo(el: ViewElement): BranchableRepo {
  const repo = el.context(
    (v): v is BranchableRepo => v instanceof BranchableRepo,
  );
  if (repo === null) {
    throw new Error(
      `[overlock-patchwork] <${el.localName}>: no ancestor context with a BranchableRepo value in scope`,
    );
  }
  return repo;
}

function runCleanup(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error("[overlock-patchwork] cleanup threw", err);
  }
}
