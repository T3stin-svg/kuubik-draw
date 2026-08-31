import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "..",
  testMatch: "visual-shell.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5205",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -w @kuubik/draw-web -- --port 5205 --strictPort",
    url: "http://127.0.0.1:5205/d/local",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
