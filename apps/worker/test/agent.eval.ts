import { beforeEach, describe, inject, test } from "vitest";
import { anthropicModel } from "../src/model.ts";
import { agentEvals, ask } from "./agent-evals.ts";
import { useModel } from "./model-fake.ts";

// The Agent's evals (test/agent-evals.ts) against the real model with the person's own key, run
// by hand whenever the prompt (src/agent.ts), the tools' descriptions or the model changes:
//
//   AGENT_API_KEY=… [AGENT_MODEL=…] bun run evals
//
// CI never runs them (vitest.evals.config.ts). Each eval runs once, so a model that passes one
// only sometimes shows it over a few runs. A refused call is logged with what it sent and why, and
// a failure prints each call the Run made; file one as a ticket with the date, the model and the
// commit.

const real = inject("realModel");
if (!real) throw new Error("The evals run on the real model only: `bun run evals`");
const configured = anthropicModel({ AGENT_API_KEY: real.key, AGENT_MODEL: real.model });
if (typeof configured === "string") throw new Error(`No model to run the evals on: ${configured}`);
const model = configured;

beforeEach(() => useModel(model));

describe("the Agent's evals", () => {
  for (const { name, seed, request, judge } of agentEvals) {
    test(name, async () => {
      const seeded = await seed();
      await judge(seeded, await ask(seeded, request));
    });
  }
});
