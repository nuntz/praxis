import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Makes this release's fixture (section 13), by hand: `bun run fixture`. Praxis as the tests run
// it, the scenario in test/fixture-scenario.ts, and a sink on this machine that saves what it
// made under test/fixtures/ (scripts/fixture-sink.ts).
export default defineConfig({
  plugins: [
    cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, main: "./test/worker.ts" }),
  ],
  test: {
    include: ["test/fixture.make.ts"],
    setupFiles: ["./test/setup.ts"],
    globalSetup: ["./scripts/fixture-sink.ts"],
  },
});
