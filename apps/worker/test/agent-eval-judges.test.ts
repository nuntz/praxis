import { describe, expect, test } from "vitest";
import { agentEvals, ask } from "./agent-evals.ts";
import { scriptModel } from "./model-fake.ts";

// The Agent's evals run by hand against the real model (test/agent.eval.ts), so nothing else would
// show a judge gone wrong: a tool renamed, or a rule of the tool layer changed, until the next run
// blamed the model for it. Here each judge is held to its eval, on a scripted model: it passes the
// good outcome its eval plays and fails the bad one. This asserts the judges, never the Agent.

describe("each of the Agent's evals passes its good outcome", () => {
  for (const { name, seed, request, judge, good } of agentEvals) {
    test(name, async () => {
      scriptModel(good);
      const seeded = await seed();

      await judge(seeded, await ask(seeded, request));
    });
  }
});

describe("each of the Agent's evals fails its bad outcome", () => {
  for (const { name, seed, request, judge, bad } of agentEvals) {
    test(name, async () => {
      scriptModel(bad);
      const seeded = await seed();

      // Failed by the judge's own assertion, not by the Run or the harness going wrong.
      await expect(judge(seeded, await ask(seeded, request))).rejects.toMatchObject({
        name: "AssertionError",
      });
    });
  }
});
