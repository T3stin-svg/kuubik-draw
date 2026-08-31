import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        draw: resolve(appRoot, "index.html"),
        scope: resolve(appRoot, "scope.html"),
      },
    },
  },
  server: { port: 5190, strictPort: true },
  preview: { port: 5191, strictPort: true },
});
