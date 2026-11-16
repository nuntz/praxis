import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, ACCESS_TOKEN } = process.env;

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  // Every tool call logs a line, so a passing test's output is left out; a failing one keeps it.
  // The marker check reads the console itself and is unaffected.
  test: {
    setupFiles: ["./test/setup.ts"],
    silent: "passed-only",
    // A real Access application, given by hand, to run the key set's contract against as well as
    // the fake (test/access.test.ts). CI gives none.
    provide: {
      realAccess:
        ACCESS_TEAM_DOMAIN && ACCESS_AUD && ACCESS_TOKEN
          ? { teamDomain: ACCESS_TEAM_DOMAIN, audience: ACCESS_AUD, token: ACCESS_TOKEN }
          : null,
    },
  },
});
