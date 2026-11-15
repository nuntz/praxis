import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  // Every tool call logs a line, so a passing test's output is left out; a failing one keeps it.
  // The marker check reads the console itself and is unaffected.
  test: { setupFiles: ["./test/setup.ts"], silent: "passed-only" },
});
