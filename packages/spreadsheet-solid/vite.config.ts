import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default defineConfig({
  plugins: [solid(), cssInjectedByJsPlugin()],
  build: {
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "spreadsheet-solid.js",
    },
    rollupOptions: {
      external: [
        "solid-js",
        "solid-js/web",
        "solid-js/store",
        "@automerge/automerge",
        "@automerge/automerge-repo",
        "ohm-js",
      ],
      output: {
        paths: {
          "solid-js": "https://esm.sh/solid-js@1.9.5",
          "solid-js/web": "https://esm.sh/solid-js@1.9.5/web",
          "solid-js/store": "https://esm.sh/solid-js@1.9.5/store",
          "ohm-js": "https://esm.sh/ohm-js@17",
        },
      },
    },
  },
});
