import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/view.ts",
      formats: ["es"],
      fileName: () => "patchwork.js",
    },
  },
});
