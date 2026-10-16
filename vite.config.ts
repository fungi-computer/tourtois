import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Mirrors the captured Publisher recipe: the Release page plus its shell
// module, emitted as shell.js with its `mountShell` export intact.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-spa",
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL("index.html", import.meta.url)),
        shell: fileURLToPath(new URL("src/shell-module.ts", import.meta.url)),
      },
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: (chunk) =>
          chunk.isEntry && chunk.name === "shell"
            ? "shell.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
