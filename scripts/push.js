#!/usr/bin/env node
/**
 * Push a folder of subfolders to Subduction.
 *
 * Each direct subfolder is synced via the `pushwork` CLI (assumed to be on
 * $PATH), which produces `<sub>/.pushwork/snapshot.json` containing a
 * `rootDirectoryUrl` for that subfolder. This script then maintains a
 * single root folder document linking each subfolder by URL, and stores
 * just `{ "rootFolderUrl": "automerge:..." }` in
 * `<folder>/.pushwork/snapshot.json`.
 *
 * Usage:
 *   yarn push <folder>
 *   yarn push <folder> --force
 *   yarn push <folder> --verbose
 *
 *   --force      Always run pushwork on every subfolder. By default a
 *                subfolder is skipped when no file under it has been
 *                modified since the mtime of its `.pushwork/snapshot.json`
 *                (which pushwork rewrites on each sync).
 *   --verbose    Stream all pushwork/yarn output. Default is a compact
 *                live tree that only surfaces output on failure.
 *
 * Whenever a subfolder *is* about to be synced (i.e. not skipped) and
 * has a top-level `package.json` with a `scripts.build` entry, we run
 * `yarn install` followed by `yarn build` in that subfolder first so
 * any generated output (e.g. `dist/`) is part of the push.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { Repo, initSubduction } from "@automerge/automerge-repo";

const SUBDUCTION_ENDPOINT = "wss://subduction.sync.inkandswitch.com";

// Tolerated noise files at the top level (everything else fails the
// "only direct subfolders allowed" check).
const TOLERATED_TOP_LEVEL_ENTRIES = new Set([".pushwork", ".DS_Store"]);

function printHelpAndExit(code) {
  const msg = [
    "Usage: yarn push <folder> [--force] [--verbose]",
    "",
    "  <folder>     Folder containing subfolders to push (required).",
    "  --force      Run pushwork on every subfolder even if no local files",
    "               have changed since the last sync.",
    "  --verbose    Stream all pushwork/yarn output. Default is a compact",
    "               live tree that only surfaces output on failure.",
  ].join("\n");
  console.log(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let folder = null;
  let force = false;
  let verbose = false;
  for (const a of args) {
    if (a === "--force") {
      force = true;
    } else if (a === "--verbose" || a === "-v") {
      verbose = true;
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      printHelpAndExit(1);
    } else if (folder === null) {
      folder = a;
    } else {
      console.error(`Unexpected positional argument: ${a}`);
      printHelpAndExit(1);
    }
  }
  if (!folder) {
    console.error("Missing required <folder> argument.");
    printHelpAndExit(1);
  }
  return { folder, force, verbose };
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// In capture mode we buffer stdout/stderr and only flush them on
// failure, so the live tree renderer can keep its cursor math correct.
function runChild(cmd, args, cwd, { capture, missingMessage }) {
  return new Promise((resolve, reject) => {
    const stdio = capture ? ["ignore", "pipe", "pipe"] : "inherit";
    const env = capture
      ? { ...process.env, NODE_NO_WARNINGS: "1" }
      : process.env;
    const child = spawn(cmd, args, { cwd, stdio, env });
    let buf = "";
    if (capture) {
      child.stdout.on("data", (d) => (buf += d.toString()));
      child.stderr.on("data", (d) => (buf += d.toString()));
    }
    child.on("error", (err) => {
      if (err.code === "ENOENT" && missingMessage) {
        reject(new Error(missingMessage));
      } else {
        reject(err);
      }
    });
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      if (capture && buf) process.stderr.write(buf);
      reject(
        new Error(
          `${cmd} ${args.join(" ")} (in ${cwd ?? process.cwd()}) exited with ${code ?? `signal ${signal}`}`
        )
      );
    });
  });
}

function runPushwork(args, cwd, { verbose }) {
  return runChild("pushwork", args, cwd, {
    capture: !verbose,
    missingMessage:
      "Could not find `pushwork` on PATH. Build and link it from /Users/paulsonnentag/repos/pushwork (`yarn install && yarn build && yarn link`).",
  });
}

function runYarn(args, cwd, { verbose }) {
  return runChild("yarn", args, cwd, {
    capture: !verbose,
    missingMessage: "Could not find `yarn` on PATH.",
  });
}

async function syncSubfolder(absPath, { verbose }) {
  const pushworkDir = path.join(absPath, ".pushwork");
  if (await pathExists(pushworkDir)) {
    if (verbose) console.log(`\n=== pushwork sync ${absPath} ===`);
    await runPushwork(["sync"], absPath, { verbose });
    return "synced";
  }
  if (verbose) {
    console.log(
      `\n=== pushwork init --shape patchwork-folder ${absPath} ===`
    );
  }
  await runPushwork(
    ["init", "--shape", "patchwork-folder"],
    absPath,
    { verbose }
  );
  return "added";
}

async function readPackageJson(absPath) {
  const pkgPath = path.join(absPath, "package.json");
  if (!(await pathExists(pkgPath))) return null;
  try {
    const raw = await fs.readFile(pkgPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(
      `warning: could not parse ${pkgPath}: ${err?.message ?? err}`
    );
    return null;
  }
}

// Run `yarn install` then `yarn build` in the subfolder if its
// package.json has a build script. Called only when we've already
// decided to sync — building when nothing changed would just churn the
// dist mtimes and force a noop sync next time.
async function buildSubfolderIfNeeded(absPath, { verbose }) {
  const pkg = await readPackageJson(absPath);
  if (!pkg || typeof pkg.scripts?.build !== "string") return;
  if (verbose) console.log(`\n=== yarn install ${absPath} ===`);
  await runYarn(["install"], absPath, { verbose });
  if (verbose) console.log(`\n=== yarn build ${absPath} ===`);
  await runYarn(["build"], absPath, { verbose });
}

async function processSubfolder(sub, { force, verbose, renderer }) {
  const lastPushedMarker = path.join(
    sub.absPath,
    ".pushwork",
    LAST_PUSHED_MARKER
  );
  const hasMarker = await pathExists(lastPushedMarker);

  let skip = false;
  if (!force && hasMarker) {
    const lastPushMs = (await fs.stat(lastPushedMarker)).mtimeMs;
    const maxMs = await findMaxMtimeMs(sub.absPath);
    if (maxMs <= lastPushMs) skip = true;
  }

  if (skip) {
    if (verbose) {
      console.log(`(unchanged) skipping pushwork sync for ${sub.name}`);
    }
    sub.status = "done";
    sub.action = "unchanged";
    renderer?.render();
  } else {
    sub.status = "building";
    renderer?.render();
    try {
      await buildSubfolderIfNeeded(sub.absPath, { verbose });
      sub.status = "syncing";
      renderer?.render();
      sub.action = await syncSubfolder(sub.absPath, { verbose });
      await touchLastPushedMarker(sub.absPath);
      sub.status = "done";
    } catch (err) {
      sub.status = "failed";
      renderer?.render();
      throw err;
    }
    renderer?.render();
  }

  sub.url = await readSubfolderRootUrl(sub.absPath);
  if (!sub.url) {
    throw new Error(
      `Subfolder ${sub.name} has no rootUrl in .pushwork/config.json after sync`
    );
  }
}

async function readSubfolderRootUrl(absPath) {
  const configPath = path.join(absPath, ".pushwork", "config.json");
  if (!(await pathExists(configPath))) return null;
  const raw = await fs.readFile(configPath, "utf8");
  const data = JSON.parse(raw);
  return data.rootUrl ?? null;
}

const LAST_PUSHED_MARKER = ".last-pushed";

async function touchLastPushedMarker(absPath) {
  const markerPath = path.join(absPath, ".pushwork", LAST_PUSHED_MARKER);
  const now = new Date();
  await fs.writeFile(markerPath, "", "utf8");
  await fs.utimes(markerPath, now, now);
}

// Names skipped while computing a subfolder's "last touched" mtime. We
// purposely ignore .pushwork (pushwork rewrites files in there during
// sync), .DS_Store (Finder churn is not interesting), and node_modules
// (yarn churns it on every install and it's full of symlinks — neither
// of which says anything about whether source changed since last sync).
const MTIME_IGNORED_NAMES = new Set([".pushwork", ".DS_Store", "node_modules"]);

// Find the most recent mtime (in ms) anywhere under `rootAbs`, including
// directory mtimes so that adding/removing files (which doesn't touch
// existing files' mtimes) still bumps the answer. Uses lstat so dangling
// symlinks (e.g. from a partially-applied yarn install) don't blow up
// the walk and so we don't accidentally recurse out of the source tree.
async function findMaxMtimeMs(rootAbs) {
  let maxMs = 0;
  async function walk(p) {
    const stat = await fs.lstat(p);
    if (stat.mtimeMs > maxMs) maxMs = stat.mtimeMs;
    if (!stat.isDirectory()) return;
    const entries = await fs.readdir(p, { withFileTypes: true });
    for (const e of entries) {
      if (MTIME_IGNORED_NAMES.has(e.name)) continue;
      await walk(path.join(p, e.name));
    }
  }
  await walk(rootAbs);
  return maxMs;
}

async function readRootSnapshot(rootSnapshotPath) {
  if (!(await pathExists(rootSnapshotPath))) return null;
  const raw = await fs.readFile(rootSnapshotPath, "utf8");
  return JSON.parse(raw);
}

async function writeRootSnapshot(rootSnapshotPath, snapshot) {
  await fs.mkdir(path.dirname(rootSnapshotPath), { recursive: true });
  await fs.writeFile(
    rootSnapshotPath,
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf8"
  );
}

// Mirrors pushwork's safeRepoShutdown (see
// /Users/paulsonnentag/repos/pushwork/src/commands.ts). Two things
// matter here:
//
// 1. A pre-shutdown grace period. Our `waitForHandleStable` only
//    watches *local* head stability, which doesn't prove the server
//    received anything. Giving in-flight `syncWithAllPeers` calls a few
//    seconds to actually deliver before we tear the repo down avoids
//    silently losing the latest change.
// 2. WebSocket errors during shutdown are common and non-critical;
//    pushwork suppresses them rather than crashing the process.
//
// Override the grace period via PUSHWORK_SYNC_GRACE_MS for parity with
// pushwork.
async function safeRepoShutdown(repo) {
  const graceMsEnv = process.env.PUSHWORK_SYNC_GRACE_MS;
  const graceMs = graceMsEnv !== undefined ? Number(graceMsEnv) : 3000;
  if (Number.isFinite(graceMs) && graceMs > 0) {
    await new Promise((r) => setTimeout(r, graceMs));
  }

  const onUncaught = (err) => {
    if (err?.message?.includes("WebSocket")) return;
    throw err;
  };
  process.on("uncaughtException", onUncaught);
  try {
    await repo.shutdown();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("WebSocket")) throw err;
  } finally {
    process.off("uncaughtException", onUncaught);
  }
}

// Subduction has no StorageId we can verify against, so we wait for the
// document's heads to stop moving for a few consecutive checks. Mirrors
// pushwork's waitForSyncViaHeadStability.
async function waitForHandleStable(handle, {
  timeoutMs = 30000,
  pollIntervalMs = 100,
  stableRequired = 5,
} = {}) {
  const start = Date.now();
  let last = JSON.stringify(handle.heads());
  let stable = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const cur = JSON.stringify(handle.heads());
    if (cur === last) {
      stable++;
      if (stable >= stableRequired) return;
    } else {
      stable = 0;
      last = cur;
    }
  }
  console.warn(
    `warning: heads for ${handle.url} did not stabilize within ${timeoutMs}ms`
  );
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function statusGlyph(sub, frame) {
  switch (sub.status) {
    case "pending":
      return "·";
    case "building":
    case "syncing":
      return SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    case "failed":
      return "❌";
    case "done":
      if (sub.action === "unchanged") return "⚪";
      if (sub.action === "added") return "➕";
      if (sub.action === "synced") return "✅";
      return "·";
    default:
      return "·";
  }
}

function statusLabel(sub) {
  if (sub.status === "building") return "building…";
  if (sub.status === "syncing") return "syncing…";
  if (sub.status === "done") {
    return sub.action === "unchanged" ? "" : sub.action;
  }
  if (sub.status === "failed") return "failed";
  return "";
}

// Live tree renderer for non-verbose mode. Re-renders the whole block
// each tick by jumping the cursor up `lineCount` lines and overwriting.
// Falls back to plain per-transition log lines on non-TTY stdout (so
// piping to a file or running in CI still produces readable output).
function createTreeRenderer(folderName, subs) {
  const isTTY = Boolean(process.stdout.isTTY);
  const lineCount = subs.length + 1;
  let printed = false;
  let frame = 0;
  let timer = null;
  const lastPlain = new Map();

  function draw() {
    const out = [];
    if (printed) out.push(`\x1b[${lineCount}A`);
    out.push(`\x1b[2K📦 ${folderName}\n`);
    for (const s of subs) {
      const label = statusLabel(s);
      const labelPart = label ? `  \x1b[2m${label}\x1b[0m` : "";
      out.push(`\x1b[2K  ${statusGlyph(s, frame)} ${s.name}${labelPart}\n`);
    }
    process.stdout.write(out.join(""));
    printed = true;
  }

  function plainTransitions() {
    for (const s of subs) {
      const key = `${s.status}:${s.action ?? ""}`;
      if (lastPlain.get(s.name) === key) continue;
      lastPlain.set(s.name, key);
      const label = statusLabel(s);
      if (label) process.stdout.write(`  ${s.name}: ${label}\n`);
    }
  }

  return {
    start() {
      if (!isTTY) {
        process.stdout.write(`📦 ${folderName}\n`);
        plainTransitions();
        return;
      }
      draw();
      timer = setInterval(() => {
        frame++;
        draw();
      }, 80);
    },
    render() {
      if (!isTTY) {
        plainTransitions();
        return;
      }
      draw();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTTY) draw();
      else plainTransitions();
    },
  };
}

async function main() {
  const { folder, force, verbose } = parseArgs(process.argv);

  if (!verbose) {
    // Drop Node's default "warning" listener so noisy in-process
    // warnings (e.g. TimeoutNegativeWarning from automerge-repo) don't
    // leak through the compact tree output. Setting NODE_NO_WARNINGS=1
    // wouldn't help here — the script is already running.
    for (const fn of process.listeners("warning")) {
      process.removeListener("warning", fn);
    }
  }

  const absFolder = path.resolve(folder);

  const stat = await fs.stat(absFolder).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error(`Not a directory: ${absFolder}`);
    process.exit(1);
  }

  const folderName = path.basename(absFolder);
  const rootPushworkDir = path.join(absFolder, ".pushwork");
  const rootSnapshotPath = path.join(rootPushworkDir, "snapshot.json");

  const entries = await fs.readdir(absFolder, { withFileTypes: true });
  let subfolders = [];
  const offending = [];
  for (const e of entries) {
    if (TOLERATED_TOP_LEVEL_ENTRIES.has(e.name)) continue;
    if (e.isDirectory()) {
      subfolders.push({ name: e.name, absPath: path.join(absFolder, e.name) });
    } else {
      offending.push(e.name);
    }
  }
  if (offending.length > 0) {
    console.error(
      `Refusing to push: ${absFolder} contains non-folder entries (only direct subfolders are supported):\n  - ${offending.join("\n  - ")}`
    );
    process.exit(1);
  }
  if (subfolders.length === 0) {
    console.error(`No subfolders found in ${absFolder}.`);
    process.exit(1);
  }

  subfolders.sort((a, b) => a.name.localeCompare(b.name));
  for (const sub of subfolders) {
    sub.status = "pending";
    sub.action = null;
  }

  const renderer = verbose ? null : createTreeRenderer(folderName, subfolders);
  renderer?.start();

  try {
    const results = await Promise.allSettled(
      subfolders.map((sub) =>
        processSubfolder(sub, { force, verbose, renderer })
      )
    );
    const failures = results.flatMap((r, i) =>
      r.status === "rejected" ? [{ sub: subfolders[i], reason: r.reason }] : []
    );
    if (failures.length > 0) {
      renderer?.stop();
      for (const f of failures) {
        const msg = f.reason?.stack ?? f.reason?.message ?? String(f.reason);
        console.error(`\n[${f.sub.name}] ${msg}`);
      }
      throw new Error(`${failures.length} subfolder(s) failed to sync`);
    }
  } finally {
    renderer?.stop();
  }

  await initSubduction();
  const repo = new Repo({
    subductionWebsocketEndpoints: [SUBDUCTION_ENDPOINT],
  });

  const rootSnapshot = (await readRootSnapshot(rootSnapshotPath)) ?? {};
  let rootHandle;
  if (rootSnapshot.rootFolderUrl) {
    if (verbose) {
      console.log(`\nLoading root folder doc ${rootSnapshot.rootFolderUrl}`);
    }
    rootHandle = await repo.find(rootSnapshot.rootFolderUrl);
    await rootHandle.whenReady();
  } else {
    if (verbose) {
      console.log(`\nCreating new root folder doc for "${folderName}"`);
    }
    rootHandle = repo.create({
      "@patchwork": { type: "folder" },
      name: folderName,
      title: folderName,
      docs: subfolders.map((s) => ({
        name: s.name,
        type: "folder",
        url: s.url,
      })),
    });
  }

  const desired = subfolders.map((s) => ({
    name: s.name,
    type: "folder",
    url: s.url,
  }));

  rootHandle.change((doc) => {
    if (!doc["@patchwork"]) doc["@patchwork"] = { type: "folder" };
    if (!doc.name) doc.name = folderName;
    if (!doc.title) doc.title = folderName;
    if (!doc.docs) doc.docs = [];

    const desiredByName = new Map(desired.map((d) => [d.name, d]));
    const seen = new Set();

    for (let i = doc.docs.length - 1; i >= 0; i--) {
      const entry = doc.docs[i];
      const wanted = desiredByName.get(entry.name);
      if (!wanted) {
        doc.docs.splice(i, 1);
        continue;
      }
      seen.add(entry.name);
      if (entry.url !== wanted.url) doc.docs[i].url = wanted.url;
      if (entry.type !== "folder") doc.docs[i].type = "folder";
    }

    for (const d of desired) {
      if (seen.has(d.name)) continue;
      doc.docs.push({ name: d.name, type: d.type, url: d.url });
    }
  });

  if (verbose) console.log("\nWaiting for sync...");
  await waitForHandleStable(rootHandle);

  await writeRootSnapshot(rootSnapshotPath, { rootFolderUrl: rootHandle.url });

  if (verbose) {
    printVerboseSummary(folderName, rootHandle.url, subfolders);
  } else {
    console.log(`\nRoot folder: ${rootHandle.url}`);
  }

  await safeRepoShutdown(repo);
  process.exit(0);
}

function printVerboseSummary(folderName, rootUrl, subfolders) {
  const changed = subfolders.filter((s) => s.action !== "unchanged");
  if (changed.length === 0) {
    console.log("\nEverything up-to-date");
    return;
  }

  const nameWidth = Math.max(...changed.map((s) => s.name.length));
  const actionWidth = Math.max(...changed.map((s) => s.action.length));

  console.log(`\n=== Push summary: ${folderName} ===`);
  console.log(`Root folder: ${rootUrl}\n`);
  for (const s of changed) {
    console.log(
      `  ${s.name.padEnd(nameWidth)}  ${s.action.padEnd(actionWidth)}  ${s.url}`
    );
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? err);
  process.exit(1);
});
