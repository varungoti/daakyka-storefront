import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Playwright never reads .env on its own, but the specs need ADMIN_SEED_PASSWORD
// (and rbac-sessions needs DATABASE_URL and AUTH_SECRET), and the error that
// asks for them says "set it in .env" (F-252). Load it the way the tsx test
// scripts do (--env-file-if-exists=.env): a variable already exported in the
// shell wins over the file, and a missing file is fine (CI exports everything).
if (existsSync(".env")) process.loadEnvFile(".env");

process.env.DISABLE_RATE_LIMIT = "1";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "dogfood-output/playwright-report" }]],
  outputDir: "dogfood-output/test-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
