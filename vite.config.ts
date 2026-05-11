import { defineConfig } from "vite";
import type { Plugin } from "vite";
import wasm from "vite-plugin-wasm";
import patchwork from "@inkandswitch/patchwork-bootloader/vite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const automergeEntryDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge"))
);
const subductionDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge-subduction"))
);

export default defineConfig({
  plugins: [wasm(), patchwork()],
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  resolve: {
    alias: {
      // Pin bare and /slim specifiers to the slim entry so every importer
      // shares one wasm-bindgen glue module. The fullfat/bundler/web entries
      // ship a *different* glue file (web/ vs bundler/), and mixing them
      // produces "expected instance of SyncState" because each glue has its
      // own interner table. Wasm is initialized once in src/main.ts.
      // Subpath aliases must come before the bare specifier (longest-prefix wins).
      "@automerge/automerge/slim": resolve(automergeEntryDir, "slim.js"),
      "@automerge/automerge": resolve(automergeEntryDir, "slim.js"),
      "@automerge/automerge-subduction/slim": resolve(subductionDir, "slim.js"),
      "@automerge/automerge-subduction": resolve(subductionDir, "slim.js"),
    },
  },
  optimizeDeps: {
    // Keep Vite's dep pre-bundler out of these packages: esbuild would resolve
    // them via the package's `browser` export (fullfat / bundler), bypassing
    // the slim aliases above and reintroducing the dual-glue bug in dev.
    exclude: [
      "@automerge/automerge",
      "@automerge/automerge/slim",
      "@automerge/automerge-subduction",
      "@automerge/automerge-subduction/slim",
    ],
  },
  build: {
    target: "es2022",
    minify: false,
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
  },
});
