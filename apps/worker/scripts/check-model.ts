import { unpricedModel } from "../src/model.ts";

// The check a deploy runs before anything else (ADR 0017): a configured model with no price
// shipped with the code fails the deploy with the reason, so no Run goes uncounted against the
// spend cap. It reads the model's name from the environment, as the configuration gives it.
//
//   AGENT_MODEL=… bun scripts/check-model.ts
//
// The deploy (.github/workflows/ci.yml) runs it before `wrangler deploy`, so the Worker keeps its
// configuration, and the setup wizard runs it as the model is named.

const reason = unpricedModel({ AGENT_MODEL: process.env.AGENT_MODEL ?? "" });
if (reason !== null) {
  console.error(reason);
  process.exit(1);
}
