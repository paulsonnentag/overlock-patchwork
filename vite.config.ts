import { defineConfig } from "vite";
import type { Plugin } from "vite";
import wasm from "vite-plugin-wasm";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const automergeEntryDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge")),
);
const subductionDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge-subduction")),
);

export default defineConfig({
  plugins: [wasm(), automergeAssets()],
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  resolve: {
    alias: {
      // Subpath aliases must come before the bare specifier (longest-prefix wins).
      "@automerge/automerge/slim": resolve(automergeEntryDir, "slim.js"),
      "@automerge/automerge": resolve(automergeEntryDir, "fullfat_bundler.js"),
      "@automerge/automerge-subduction/slim": resolve(subductionDir, "slim.js"),
      "@automerge/automerge-subduction": resolve(subductionDir, "web.js"),
    },
  },
  optimizeDeps: {
    // Prevent Vite from pre-bundling automerge-subduction (which ignores the
    // resolve alias and picks the bundler target whose .wasm import gets dropped).
    exclude: [
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
    rollupOptions: {
      input: {
        app: "index.html",
        "service-worker": "src/service-worker.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "service-worker"
            ? "service-worker.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});

function automergeAssets(): Plugin {
  return {
    name: "automerge-assets",
    buildStart() {
      this.emitFile({
        type: "asset",
        fileName: "automerge.wasm",
        source: readFileSync(require.resolve("@automerge/automerge/automerge.wasm")),
      });
      this.emitFile({
        type: "asset",
        fileName: "subduction.wasm",
        source: readFileSync(require.resolve("@automerge/automerge-subduction/wasm")),
      });
    },
  };
}
