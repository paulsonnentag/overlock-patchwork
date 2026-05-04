import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default defineConfig({
  plugins: [solid(), cssInjectedByJsPlugin()],
  build: {
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
        "@automerge/automerge-codemirror",
        "@codemirror/commands",
        "@codemirror/lang-markdown",
        "@codemirror/language",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/highlight",
      ],
      output: {
        paths: {
          "solid-js": "https://esm.sh/solid-js@1.9.5",
          "solid-js/web": "https://esm.sh/solid-js@1.9.5/web",
          "@automerge/automerge-codemirror":
            "https://esm.sh/@automerge/automerge-codemirror@0.2.0",
          "@codemirror/commands": "https://esm.sh/@codemirror/commands@6.6.0",
          "@codemirror/lang-markdown":
            "https://esm.sh/@codemirror/lang-markdown@6.3.0",
          "@codemirror/language": "https://esm.sh/@codemirror/language@6.12.0",
          "@codemirror/state": "https://esm.sh/@codemirror/state@6.5.0",
          "@codemirror/view": "https://esm.sh/@codemirror/view@6.41.0",
          "@lezer/highlight": "https://esm.sh/@lezer/highlight@1.2.0",
        },
      },
    },
  },
});
