import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import patchwork from "@inkandswitch/patchwork-bootloader/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const automergeEntryDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge")),
);
const subductionDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge-subduction")),
);

export default defineConfig({
  plugins: [wasm(), patchwork()],
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
  },
});
