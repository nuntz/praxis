import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Agent's evals (section 13), run by hand against the real model with the person's own key:
//
//   AGENT_API_KEY=… [AGENT_MODEL=…] bun run evals
//
// Praxis as the tests run it (test/worker.ts), with each Context's Agent on the real model in
// place of a script. CI never runs them: the worker's tests take only *.test.ts, and this config
// is no step of CI's.
const { AGENT_API_KEY, AGENT_MODEL } = process.env;
if (!AGENT_API_KEY?.trim()) {
  throw new Error(
    "The Agent's evals run against the real model: give its key as AGENT_API_KEY, and the model as AGENT_MODEL unless it is the default.",
  );
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      main: "./test/worker.ts",
      miniflare: { assets: { directory: "./test/no-screen" } },
    }),
  ],
  test: {
    include: ["test/agent.eval.ts"],
    setupFiles: ["./test/setup.ts"],
    // A Run on the real model takes seconds a round, and asks again for seconds when it cannot
    // be reached.
    testTimeout: 300_000,
    provide: { realModel: { key: AGENT_API_KEY, model: AGENT_MODEL ?? "" } },
  },
});
