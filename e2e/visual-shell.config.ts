import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "..",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5215",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -w @kuubik/draw-web -- --port 5215",
    url: "http://127.0.0.1:5215/d/local",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
