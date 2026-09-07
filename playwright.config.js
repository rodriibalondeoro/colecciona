import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        port: 3000,
        reuseExistingServer: true,
        timeout: 30000,
      },
});
