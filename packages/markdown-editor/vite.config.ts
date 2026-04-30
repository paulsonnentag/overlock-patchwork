import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Build a single ESM file at dist/markdown-editor.js. The Automerge
// runtimes are externalised: at runtime overlock's Loader resolves
// those bare specifiers to its window.__overlock-backed shims so we
// share the host's wasm-initialised instance. Solid is rewritten to
// an esm.sh URL so the browser fetches it directly (kept out of the
// bundle for size and parity with the other overlock packages).
// CodeMirror packages stay bundled — there's no shared state across
// the boundary that needs deduping.
export default defineConfig({
  plugins: [solid()],
  build: {
    target: "es2022",
    minify: false,
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "markdown-editor.js",
    },
    rollupOptions: {
      external: [
        "solid-js",
        "solid-js/web",
        "@automerge/automerge",
        "@automerge/automerge-repo",
      ],
      output: {
        paths: {
          "solid-js": "https://esm.sh/solid-js@1.9.5",
          "solid-js/web": "https://esm.sh/solid-js@1.9.5/web",
        },
      },
    },
  },
});
