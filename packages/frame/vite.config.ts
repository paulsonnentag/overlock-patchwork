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
        "account-provider": "src/account-provider.json",
        "document-selection-provider": "src/document-selection-provider.json",
        "document-selection-url-sync": "src/document-selection-url-sync.json",
        "folder-list": "src/folder-list.json",
        "package-registry-provider": "src/package-registry-provider.json",
        "single-view": "src/single-view.json",
      },
      formats: ["es"],
    },
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
