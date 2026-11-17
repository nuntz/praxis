import { defineConfig, devices } from "@playwright/test";

// The stand-in for Access listens here and starts the Worker on the next port up, so the pair is
// kept clear of `bun run dev`'s, 8787 and 8788, and the journeys run beside it.
const port = 8790;

// Playwright empties its output folder as a run starts, so a local run keeps its own, and a
// failure's trace outlives the runs made after it to reproduce it. Set once here, the stamp
// reaches the workers, which load this file again. In CI the workflow uploads the folder.
process.env.PRAXIS_E2E_RUN ??= new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.CI ? "test-results" : `test-results/${process.env.PRAXIS_E2E_RUN}`;

export default defineConfig({
  testDir: "e2e",
  outputDir,
  // Only a failure's output is kept: a run that passed leaves its .last-run.json alone, which a
  // later run cannot find, so `--last-failed` reruns nothing locally.
  preserveOutput: "failures-only",
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
  // The built PWA served by the real Worker, on a Journal that starts empty each run, with each
  // Context's Agent on a scripted model (apps/worker/test/journey-worker.ts).
  webServer: {
    command: `rm -rf .wrangler/e2e && bun run build && bun run --cwd apps/worker dev --port ${port} --persist-to ../../.wrangler/e2e test/journey-worker.ts`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
