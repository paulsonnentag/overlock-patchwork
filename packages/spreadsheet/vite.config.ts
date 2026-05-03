import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "spreadsheet.js",
    },
    rollupOptions: {
      external: ["ohm-js"],
      output: {
        paths: {
          "ohm-js": "https://esm.sh/ohm-js@17",
        },
      },
    },
  },
});
