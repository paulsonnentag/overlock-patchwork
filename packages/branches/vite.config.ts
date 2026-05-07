import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { patchwork } from "patchwork-vite-plugin";

export default defineConfig({
  plugins: [
    patchwork({ components: ["module", "schema"] }),
    solid(),
    cssInjectedByJsPlugin(),
  ],
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        "solid-js",
        "solid-js/web",
        "solid-js/store",
        "@automerge/automerge-repo",
      ],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        paths: {
          "solid-js": "https://esm.sh/solid-js@1.9.5",
          "solid-js/web": "https://esm.sh/solid-js@1.9.5/web",
          "solid-js/store": "https://esm.sh/solid-js@1.9.5/store",
        },
      },
    },
  },
});
