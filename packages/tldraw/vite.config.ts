import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { patchwork } from "patchwork-vite-plugin";
import externals from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  plugins: [
    patchwork({ component: ["module", "schema"] }),
    wasm(),
    react(),
    cssInjectedByJsPlugin({ relativeCSSInjection: true }),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    target: "esnext",
    cssCodeSplit: true,
    sourcemap: "inline",
    assetsInlineLimit: 1_000_000,
    rollupOptions: {
      // Match the bootloader's externals list (same source of truth as
      // patchwork-base/tldraw4's esbuild config) so every specifier the host
      // resolves through its importmap — including subpaths like
      // `@automerge/automerge-repo/slim` — stays external. React isn't in
      // that list; we externalize it separately and rewrite it to esm.sh
      // via `output.paths` below.
      external: externals,
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        paths: {
          react: "https://esm.sh/react@18.3.1",
          "react-dom": "https://esm.sh/react-dom@18.3.1",
          "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
          "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
        },
      },
    },
  },
});
