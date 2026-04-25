import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Single self-contained bundle. Everything (incl. base64-encoded wasm) lives
// in dist/overlock.js so the demo works when index.html is opened via file://.
//
// The subduction alias is the same trick patchwork's tiny-patchwork uses
// (sites/tiny-patchwork/vite.config.ts lines 53-58): force the bare specifier
// onto the ESM /slim entry so vite never sees the bundler entry's ESM wasm
// import. wasm is initialised manually from base64 in src/wasm-loader.ts.
const subductionDir = dirname(
  fileURLToPath(import.meta.resolve("@automerge/automerge-subduction")),
);
const subductionSlim = resolve(subductionDir, "slim.js");

export default defineConfig({
  resolve: {
    // Use the array form so the find regex matches only the bare specifier;
    // a string alias would prefix-match `@automerge/automerge-subduction/slim`
    // and produce `<slim>/slim` paths.
    alias: [
      {
        find: /^@automerge\/automerge-subduction$/,
        replacement: subductionSlim,
      },
    ],
  },
  optimizeDeps: {
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
    // IIFE so the page can load us via plain `<script src>` — `type="module"`
    // src loads are blocked by CORS under `file://`. Dynamic `import(blob:…)`
    // calls inside the bundle still work from a classic-script context.
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      name: "OverlockBootstrap",
      formats: ["iife"],
      fileName: () => "overlock.js",
    },
  },
});
