import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// automerge-repo's initSubduction() does a bare import of
// @automerge/automerge-subduction, which Vite resolves to the bundler entry
// that imports a .wasm file directly. Redirect it to /slim so wasm is never
// seen by the bundler (we init it manually from base64 in src/main.ts).
const subductionDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge-subduction")),
);
const subductionSlim = resolve(subductionDir, "slim.js");

export default defineConfig({
  resolve: {
    // Array form so the regex matches only the bare specifier; a string alias
    // would prefix-match /slim and produce `<slim>/slim` paths.
    alias: [
      {
        find: /^@automerge\/automerge-subduction$/,
        replacement: subductionSlim,
      },
    ],
  },
  build: {
    target: "es2022",
    minify: false,
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
    // IIFE so the page can load via plain `<script src>` — `type="module"` is
    // blocked by CORS under file://.
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      name: "OverlockBootstrap",
      formats: ["iife"],
      fileName: () => "patchwork.js",
    },
  },
});
