import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running local Oiko (`pnpm local` or `docker compose up`).
// OIKO_E2E_URL overrides the base URL (default http://localhost:3000). Nothing is started here: the app must be up.
const baseURL = process.env.OIKO_E2E_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 420, height: 900 } } }],
});
