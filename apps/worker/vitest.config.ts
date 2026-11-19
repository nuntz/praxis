import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, ACCESS_TOKEN, AGENT_API_KEY, AGENT_MODEL } = process.env;
const {
  PUSH_PUBLIC_KEY,
  PUSH_PRIVATE_KEY,
  PUSH_SUBJECT,
  PUSH_SUBSCRIPTION,
  PUSH_GONE_SUBSCRIPTION,
} = process.env;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Praxis as deployed, with each Context's Agent on a scripted model (test/worker.ts).
      main: "./test/worker.ts",
    }),
  ],
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
      // The person's own model key, given by hand, to run the model's contract against the real
      // model as well as the scripted one (test/model.test.ts). CI gives none.
      realModel: AGENT_API_KEY ? { key: AGENT_API_KEY, model: AGENT_MODEL ?? "" } : null,
      // A real push service, given by hand: the Deployment's key pair and subject, and a browser's
      // subscription for that key, to run the Web Push sender's contract against
      // (test/push.test.ts). CI gives none.
      realPush:
        PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY && PUSH_SUBJECT && PUSH_SUBSCRIPTION
          ? {
              publicKey: PUSH_PUBLIC_KEY,
              privateKey: PUSH_PRIVATE_KEY,
              subject: PUSH_SUBJECT,
              subscription: PUSH_SUBSCRIPTION,
              gone: PUSH_GONE_SUBSCRIPTION ?? null,
            }
          : null,
    },
  },
});
