import { defineConfig, devices } from "@playwright/test";

const port = 8788;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  // Each Device is in a time zone of its own, and neither is UTC, so the journey that sets the
  // Context to UTC and switches it to its Device's zone finds the two different.
  projects: [
    // The first Context, which the journeys that make none of their own share.
    {
      name: "setup",
      testMatch: /\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"], timezoneId: "Pacific/Chatham" },
    },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        timezoneId: "Pacific/Chatham",
      },
    },
    {
      name: "phone",
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], timezoneId: "America/Lima" },
    },
  ],
  // The built PWA served by the real Worker, on a Journal that starts empty each run.
  webServer: {
    command: `rm -rf .wrangler/e2e && bun run build && bun run --cwd apps/worker dev --port ${port} --persist-to ../../.wrangler/e2e`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
