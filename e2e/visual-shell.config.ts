import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "..",
  testMatch: /e2e[\\/]visual-shell\.spec\.ts$/,
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5225",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -w @kuubik/draw-web -- --port 5225",
    url: "http://127.0.0.1:5225/d/local",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
