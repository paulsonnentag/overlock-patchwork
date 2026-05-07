import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function patchwork(config = {}) {
  const records = [];
  let packageRoot = "";
  let pkgJson = null;

  return {
    name: "patchwork",
    enforce: "pre",

    config(viteConfig) {
      records.length = 0;
      pkgJson = null;
      packageRoot = path.resolve(process.cwd(), viteConfig.root ?? ".");
      const pkgPath = path.resolve(packageRoot, "package.json");
      pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
      const contributions = pkgJson.contributions;
      if (!contributions || typeof contributions !== "object") return;

      const entry = {};
      for (const [kind, fieldPaths] of Object.entries(config)) {
        const arr = contributions[kind];
        if (arr === undefined) continue;
        if (!Array.isArray(arr)) {
          throw new Error(
            `patchwork: /contributions/${kind} must be an array`,
          );
        }
        arr.forEach((entryObj, idx) => {
          if (entryObj == null || typeof entryObj !== "object") {
            throw new Error(
              `patchwork: /contributions/${kind}/${idx} must be an object`,
            );
          }
          for (const fieldPath of fieldPaths) {
            const value = getDottedField(entryObj, fieldPath);
            if (value === undefined) continue;
            const pointer = `/contributions/${kind}/${idx}/${fieldPath
              .split(".")
              .join("/")}`;
            if (typeof value !== "string") {
              throw new Error(`patchwork: ${pointer} must be a string`);
            }
            if (!value.startsWith("./") && !value.startsWith("../")) {
              throw new Error(
                `patchwork: ${pointer} must start with "./" or "../" (got "${value}")`,
              );
            }
            const absolute = path.resolve(packageRoot, value);
            if (!existsSync(absolute)) {
              throw new Error(
                `patchwork: ${pointer} resolves to missing file ${absolute}`,
              );
            }
            const entryName = stripExt(value.replace(/^(\.\.?\/)+/, ""));
            entry[entryName] = absolute;
            records.push({ entryName, kind, idx, fieldPath });
          }
        });
      }

      if (Object.keys(entry).length === 0) return;

      const userLib = viteConfig.build?.lib ?? {};
      return {
        build: {
          lib: {
            formats: ["es"],
            ...userLib,
            entry,
          },
        },
      };
    },

    buildStart() {
      if (!pkgJson?.contributions) return;
      const declaredKinds = new Set(Object.keys(config));
      for (const kind of Object.keys(pkgJson.contributions)) {
        if (!declaredKinds.has(kind)) {
          this.warn(
            `contributions.${kind} is present but no plugin config declared it; URLs in this kind will not be bundled or rewritten`,
          );
        }
      }
    },

    generateBundle(_outputOptions, bundle) {
      if (!pkgJson || records.length === 0) return;
      const out = JSON.parse(JSON.stringify(pkgJson));
      for (const record of records) {
        const chunk = findEntryChunk(bundle, record.entryName);
        if (!chunk) {
          this.error(
            `patchwork: could not find built chunk for entry "${record.entryName}"`,
          );
          return;
        }
        setDottedField(
          out.contributions[record.kind][record.idx],
          record.fieldPath,
          `./${chunk.fileName}`,
        );
      }
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
