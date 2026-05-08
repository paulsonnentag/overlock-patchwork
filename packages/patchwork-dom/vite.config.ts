import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: "inline",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
  },
});
