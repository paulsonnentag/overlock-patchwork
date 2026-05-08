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
 *
 *   --force      Always run pushwork on every subfolder. By default a
 *                subfolder is skipped when no file under it has been
 *                modified since the mtime of its `.pushwork/snapshot.json`
 *                (which pushwork rewrites on each sync).
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
    "Usage: yarn push <folder> [--force]",
    "",
    "  <folder>     Folder containing subfolders to push (required).",
    "  --force      Run pushwork on every subfolder even if no local files",
    "               have changed since the last sync.",
  ].join("\n");
  console.log(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let folder = null;
  let force = false;
  for (const a of args) {
    if (a === "--force") {
      force = true;
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
  return { folder, force };
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function runPushwork(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("pushwork", args, { stdio: "inherit", cwd });
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "Could not find `pushwork` on PATH. Build and link it from /Users/paulsonnentag/repos/pushwork (`yarn install && yarn build && yarn link`)."
          )
        );
      } else {
        reject(err);
      }
    });
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `pushwork ${args.join(" ")} (in ${cwd ?? process.cwd()}) exited with ${code ?? `signal ${signal}`}`
          )
        );
    });
  });
}

async function syncSubfolder(absPath) {
  const pushworkDir = path.join(absPath, ".pushwork");
  if (await pathExists(pushworkDir)) {
    console.log(`\n=== pushwork sync ${absPath} ===`);
    await runPushwork(["sync"], absPath);
  } else {
    console.log(
      `\n=== pushwork init --sub --no-branches --shape patchwork-folder ${absPath} ===`
    );
    await runPushwork(
      ["init", "--sub", "--no-branches", "--shape", "patchwork-folder"],
      absPath
    );
  }
}

function runYarn(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("yarn", args, { stdio: "inherit", cwd });
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("Could not find `yarn` on PATH."));
      } else {
        reject(err);
      }
    });
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `yarn ${args.join(" ")} (in ${cwd}) exited with ${code ?? `signal ${signal}`}`
          )
        );
    });
  });
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

async function orderSubfoldersByPackageDeps(subfolders) {
  const byPackageName = new Map();
  const packageBySubfolder = new Map();

  for (const sub of subfolders) {
    const pkg = await readPackageJson(sub.absPath);
    packageBySubfolder.set(sub.name, pkg);
    if (!pkg?.name) continue;
    const existing = byPackageName.get(pkg.name);
    if (existing) {
      throw new Error(
        `Duplicate package name "${pkg.name}" in ${existing.name} and ${sub.name}`
      );
    }
    byPackageName.set(pkg.name, sub);
  }

  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const alphabetical = [...subfolders].sort((a, b) => a.name.localeCompare(b.name));

  for (const sub of alphabetical) visitSubfolder(sub);
  return ordered;

  function visitSubfolder(sub) {
    if (visited.has(sub.name)) return;
    if (visiting.has(sub.name)) {
      throw new Error(`Package dependency cycle involving ${sub.name}`);
    }

    visiting.add(sub.name);
    const pkg = packageBySubfolder.get(sub.name);
    for (const depName of packageDependencyNames(pkg)) {
      const dep = byPackageName.get(depName);
      if (dep && dep.name !== sub.name) visitSubfolder(dep);
    }
    visiting.delete(sub.name);
    visited.add(sub.name);
    ordered.push(sub);
  }
}

function packageDependencyNames(pkg) {
  if (!pkg) return [];
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ];
}

// Run `yarn install` then `yarn build` in the subfolder if its
// package.json has a build script. Called only when we've already
// decided to sync — building when nothing changed would just churn the
// dist mtimes and force a noop sync next time.
async function buildSubfolderIfNeeded(absPath) {
  const pkg = await readPackageJson(absPath);
  if (!pkg || typeof pkg.scripts?.build !== "string") return;
  console.log(`\n=== yarn install ${absPath} ===`);
  await runYarn(["install"], absPath);
  console.log(`\n=== yarn build ${absPath} ===`);
  await runYarn(["build"], absPath);
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

async function main() {
  const { folder, force } = parseArgs(process.argv);
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

  subfolders = await orderSubfoldersByPackageDeps(subfolders);

  for (const sub of subfolders) {
    const lastPushedMarker = path.join(
      sub.absPath,
      ".pushwork",
      LAST_PUSHED_MARKER
    );
    const hasMarker = await pathExists(lastPushedMarker);

    let skip = false;
    if (!force && hasMarker) {
      // We touch this marker ourselves after every successful sync, so
      // its mtime is a reliable "last successful sync" timestamp.
      const lastPushMs = (await fs.stat(lastPushedMarker)).mtimeMs;
      const maxMs = await findMaxMtimeMs(sub.absPath);
      if (maxMs <= lastPushMs) skip = true;
    }

    if (skip) {
      console.log(`(unchanged) skipping pushwork sync for ${sub.name}`);
    } else {
      await buildSubfolderIfNeeded(sub.absPath);
      await syncSubfolder(sub.absPath);
      await touchLastPushedMarker(sub.absPath);
    }

    sub.url = await readSubfolderRootUrl(sub.absPath);
    if (!sub.url) {
      throw new Error(
        `Subfolder ${sub.name} has no rootUrl in .pushwork/config.json after sync`
      );
    }
  }

  await initSubduction();
  const repo = new Repo({
    subductionWebsocketEndpoints: [SUBDUCTION_ENDPOINT],
  });

  const rootSnapshot = (await readRootSnapshot(rootSnapshotPath)) ?? {};
  let rootHandle;
  if (rootSnapshot.rootFolderUrl) {
    console.log(`\nLoading root folder doc ${rootSnapshot.rootFolderUrl}`);
    rootHandle = await repo.find(rootSnapshot.rootFolderUrl);
    await rootHandle.whenReady();
  } else {
    console.log(`\nCreating new root folder doc for "${folderName}"`);
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

  console.log("\nWaiting for sync...");
  await waitForHandleStable(rootHandle);

  await writeRootSnapshot(rootSnapshotPath, { rootFolderUrl: rootHandle.url });

  console.log(`\nRoot folder URL: ${rootHandle.url}`);

  await safeRepoShutdown(repo);
  process.exit(0);
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? err);
  process.exit(1);
});
