import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.{ts,tsx,mjs}",
      "packages/**/*.test.{ts,tsx,mjs}",
      "tools/**/*.test.{ts,tsx,mjs}",
    ],
    exclude: ["e2e/**", "**/dist/**", "**/node_modules/**"],
  },
});
