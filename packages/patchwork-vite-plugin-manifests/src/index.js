import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_INCLUDE = /\.json$/;

export function patchworkManifests(options = {}) {
  const include = options.include ?? DEFAULT_INCLUDE;
  const records = [];

  return {
    name: "patchwork-manifests",
    enforce: "pre",
    config(config) {
      records.length = 0;

      const lib = config.build?.lib;
      if (!lib?.entry) return;

      const root = path.resolve(process.cwd(), config.root ?? ".");
      const entry = rewriteEntry(lib.entry, root, include, records);
      if (records.length === 0) return;

      return {
        build: {
          lib: {
            ...lib,
            entry,
          },
        },
      };
    },
    generateBundle(_outputOptions, bundle) {
      for (const record of records) {
        const chunk = findEntryChunk(bundle, record.entryName);
        if (!chunk) {
          this.error(`could not find entry chunk for "${record.entryName}"`);
          return;
        }

        this.emitFile({
          type: "asset",
          fileName: record.manifestFileName,
          source:
            JSON.stringify(
              {
                ...record.manifest,
                importUrl: relativeImportUrl(
                  record.manifestFileName,
                  chunk.fileName,
                ),
              },
              null,
              2,
            ) + "\n",
        });
      }
    },
  };
}

function rewriteEntry(entry, root, include, records) {
  if (typeof entry === "string") {
    return rewriteEntryPath(stem(entry), entry, root, include, records);
  }

  if (Array.isArray(entry)) {
    return entry.map((entryPath) =>
      rewriteEntryPath(stem(entryPath), entryPath, root, include, records),
    );
  }

  return Object.fromEntries(
    Object.entries(entry).map(([entryName, entryPath]) => [
      entryName,
      rewriteEntryPath(entryName, entryPath, root, include, records),
    ]),
  );
}

function rewriteEntryPath(entryName, entryPath, root, include, records) {
  if (!include.test(entryPath)) return entryPath;

  const manifestPath = path.resolve(root, entryPath);
  const manifest = readManifest(manifestPath);
  records.push({
    entryName,
    manifest,
    manifestFileName: path.basename(manifestPath),
  });

  return path.resolve(path.dirname(manifestPath), manifest.importUrl);
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    typeof manifest.name !== "string" ||
    typeof manifest.importUrl !== "string"
  ) {
    throw new Error(`${manifestPath}: missing "name" or "importUrl"`);
  }

  if (!manifest.importUrl.startsWith("./")) {
    throw new Error(`${manifestPath}: "importUrl" must start with "./"`);
  }

  return manifest;
}

function findEntryChunk(bundle, entryName) {
  for (const item of Object.values(bundle)) {
    if (item.type === "chunk" && item.isEntry && item.name === entryName) {
      return item;
    }
  }
  return undefined;
}

function relativeImportUrl(fromFileName, toFileName) {
  const fromDir = path.posix.dirname(fromFileName);
  const relative = path.posix.relative(fromDir, toFileName);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function stem(entryPath) {
  return path.basename(entryPath, path.extname(entryPath));
}
