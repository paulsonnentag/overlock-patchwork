import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { patchwork } from "patchwork-vite-plugin";

export default defineConfig({
  plugins: [
    patchwork({ component: ["module", "schema"] }),
    topLevelAwait(),
    wasm(),
    react(),
    cssInjectedByJsPlugin({ relativeCSSInjection: true }),
  ],
  // Inline `process.env.NODE_ENV` so CJS deps (react-reconciler via
  // @react-three/fiber) don't reference `process` at runtime.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    cssCodeSplit: true,
    assetsInlineLimit: 1_000_000,
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "@automerge/automerge",
        "@automerge/automerge-repo",
      ],
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
