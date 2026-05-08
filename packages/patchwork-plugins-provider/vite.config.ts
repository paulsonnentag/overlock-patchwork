import { defineConfig } from "vite";
import { patchwork } from "patchwork-vite-plugin";

export default defineConfig({
  plugins: [patchwork({ component: ["module", "schema"] })],
  build: {
    sourcemap: true,
    rollupOptions: {
      external: ["@automerge/automerge-repo"],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
