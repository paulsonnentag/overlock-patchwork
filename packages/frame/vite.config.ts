import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { patchworkManifests } from "patchwork-vite-plugin-manifests";

export default defineConfig({
  plugins: [patchworkManifests(), solid(), cssInjectedByJsPlugin()],
  build: {
    sourcemap: true,
    lib: {
      entry: {
        root: "src/root.json",
        "account-context": "src/account-context.json",
        "document-selection-context": "src/document-selection-context.json",
        "document-selection-url-sync": "src/document-selection-url-sync.json",
        "folder-list": "src/folder-list.json",
        "single-view": "src/single-view.json",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["solid-js", "solid-js/web", "@automerge/automerge-repo"],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        paths: {
          "solid-js": "https://esm.sh/solid-js@1.9.5",
          "solid-js/web": "https://esm.sh/solid-js@1.9.5/web",
        },
      },
    },
  },
});
