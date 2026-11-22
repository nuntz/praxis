import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The meaning index's contract run by hand against Workers AI and Vectorize (section 13), with
// both bound remotely: `bun run test:meaning`. CI runs the same suite against the fake only.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./test/meaning.wrangler.jsonc" } })],
  test: {
    include: ["test/meaning-index.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // A test may wait on the index twice, each three minutes of sleeps and its reads besides
    // (test/meaning-index.test.ts), and should fail on what it waited for, not on its time.
    testTimeout: 480_000,
  },
});
