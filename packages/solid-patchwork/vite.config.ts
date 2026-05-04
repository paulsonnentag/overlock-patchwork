import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "solid-patchwork.js",
    },
    rollupOptions: {
      external: ["solid-js", "solid-js/web", "patchwork"],
    },
  },
})
