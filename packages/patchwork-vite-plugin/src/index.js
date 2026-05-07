import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ID_RE = /^[A-Za-z0-9_-]+$/;

export function patchwork(config = {}) {
  let packageRoot = "";
  let pkgJson = null;
  let entries = [];
  let records = [];

  return {
    name: "patchwork",
    enforce: "pre",

    config(viteConfig) {
      entries = [];
      records = [];
      pkgJson = null;
      packageRoot = path.resolve(process.cwd(), viteConfig.root ?? ".");
      const pkgPath = path.resolve(packageRoot, "package.json");
      pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
      const plugins = pkgJson.plugins;
      if (plugins === undefined) return;
      if (plugins == null || typeof plugins !== "object" || Array.isArray(plugins)) {
        throw new Error(`patchwork: /plugins must be an object`);
      }

      const libEntry = {};
      const seenIds = new Map();
      for (const [kind, arr] of Object.entries(plugins)) {
        if (!ID_RE.test(kind)) {
          throw new Error(
            `patchwork: /plugins/${kind} kind must match ${ID_RE} (got "${kind}")`,
          );
        }
        if (!Array.isArray(arr)) {
          throw new Error(`patchwork: /plugins/${kind} must be an array`);
        }
        const fieldPaths = config[kind];
        arr.forEach((entry, idx) => {
          const pointer = `/plugins/${kind}/${idx}`;
          if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`patchwork: ${pointer} must be an object`);
          }
          const name = entry.name;
          if (typeof name !== "string" || !ID_RE.test(name)) {
            throw new Error(
              `patchwork: ${pointer}/name must match ${ID_RE} (got ${JSON.stringify(name)})`,
            );
          }
          const id = `${name}-${kind}`;
          const prev = seenIds.get(id);
          if (prev !== undefined) {
            throw new Error(
              `patchwork: duplicate plugin (kind="${kind}", name="${name}") at ${prev} and ${pointer}`,
            );
          }
          seenIds.set(id, pointer);

          const orderIdx = entries.length;
          entries.push({ kind, idx, name, entry });

          if (!fieldPaths) return;
          for (const fieldPath of fieldPaths) {
            const value = getDottedField(entry, fieldPath);
            if (value === undefined) continue;
            const fieldPointer = `${pointer}/${fieldPath.split(".").join("/")}`;
            if (typeof value !== "string") {
              throw new Error(`patchwork: ${fieldPointer} must be a string`);
            }
            if (!value.startsWith("./") && !value.startsWith("../")) {
              throw new Error(
                `patchwork: ${fieldPointer} must start with "./" or "../" (got "${value}")`,
              );
            }
            const absolute = path.resolve(packageRoot, value);
            if (!existsSync(absolute)) {
              throw new Error(
                `patchwork: ${fieldPointer} resolves to missing file ${absolute}`,
              );
            }
            const entryName = stripExt(path.relative(packageRoot, absolute));
            libEntry[entryName] = absolute;
            records.push({ entryName, orderIdx, fieldPath });
          }
        });
      }

      if (Object.keys(libEntry).length === 0) return;

      const userLib = viteConfig.build?.lib ?? {};
      return {
        build: {
          lib: {
            formats: ["es"],
            ...userLib,
            entry: libEntry,
          },
        },
      };
    },

    buildStart() {
      if (entries.length === 0) return;
      const declared = new Set(Object.keys(config));
      const seenUnknown = new Set();
      for (const e of entries) {
        if (declared.has(e.kind) || seenUnknown.has(e.kind)) continue;
        seenUnknown.add(e.kind);
        this.warn(
          `plugins.${e.kind} is present but no plugin config declared it; URLs in this kind will not be bundled or rewritten`,
        );
      }
    },

    generateBundle(_outputOptions, bundle) {
      if (!pkgJson || entries.length === 0) return;

      const rewritten = entries.map((e) => ({
        type: e.kind,
        ...JSON.parse(JSON.stringify(e.entry)),
      }));

      for (const record of records) {
        const chunk = findEntryChunk(bundle, record.entryName);
        if (!chunk) {
          this.error(
            `patchwork: could not find built chunk for entry "${record.entryName}"`,
          );
          return;
        }
        setDottedField(
          rewritten[record.orderIdx],
          record.fieldPath,
          `./${chunk.fileName}`,
        );
      }

      const out = JSON.parse(JSON.stringify(pkgJson));
      out.plugins = entries.map((e) => `./${e.name}-${e.kind}.json`);

      entries.forEach((e, i) => {
        this.emitFile({
          type: "asset",
          fileName: `${e.name}-${e.kind}.json`,
          source: JSON.stringify(rewritten[i], null, 2) + "\n",
        });
      });

      this.emitFile({
        type: "asset",
        fileName: "package.json",
        source: JSON.stringify(out, null, 2) + "\n",
      });
    },
  };
}

function getDottedField(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function setDottedField(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function stripExt(p) {
  return p.replace(/\.[^./]+$/, "");
}

function findEntryChunk(bundle, entryName) {
  for (const item of Object.values(bundle)) {
    if (item.type === "chunk" && item.isEntry && item.name === entryName) {
      return item;
    }
  }
  return undefined;
}
