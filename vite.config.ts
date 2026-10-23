import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { fungiFaviconHref } from "@fungi.computer/sigils/favicon";

// Mirrors the captured Publisher recipe: the Release page plus its shell
// module, emitted as shell.js with its `mountShell` export intact.
export default defineConfig({
  plugins: [
    react(),
    {
      name: "fungi-favicon",
      transformIndexHtml: () => [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/svg+xml",
            href: fungiFaviconHref,
          },
          injectTo: "head",
        },
      ],
    },
  ],
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
