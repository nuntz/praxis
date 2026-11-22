import type { JsonObject } from "@earendil-works/pi-durable";
import type { MessagesPage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { calling, scriptModel } from "./model-fake.ts";
import { deploymentOffering, deploymentRunsWith, offering, runsWith } from "./offering.ts";
import { contextIn, everyCaller, hand, newContext, newDeployment, value } from "./seam.ts";

// The generic test of ADR 0015: every tool, as every caller, against the table kept by hand.
// The oracle holds a call that is not offered to changing nothing.

describe("the offering table", () => {
  for (const [tool, row] of Object.entries(offering)) {
    everyCaller.forEach((caller, column) => {
      const offered = row[column] === "yes";

      test(`${tool} is ${offered ? "" : "not "}offered to the ${caller.kind}`, async () => {
        const input = runsWith[tool];
        expect(
          input,
          `${tool} needs an input it runs with: add one to runsWith in apps/worker/test/offering.ts`,
        ).toBeDefined();

        const result = await newContext().callAny(caller, tool, input?.());

        if (!offered) expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
        else if (!result.ok)
          expect(["not_offered", "invalid_input"]).not.toContain(result.error.code);
      });
    });
  }
});

// The same table's agent and clock columns, through the Agent's runtime: a Run's calls reach the
// registry by its tools and the host's call, a path a call to the object straight never takes,
// and on which every search the Agent made was refused while the table above passed (#106).

/** A refusal that says the call never reached the tool: the caller or its input was turned away. */
const TURNED_AWAY = ["not_offered", "invalid_input"];

/** The registry's answer a tool result holds, or null for the runtime's word that the tool threw. */
function answerIn(text: string): { ok: boolean; error?: { code: string } } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

describe("the offering table, through the Agent's runtime", () => {
  for (const [tool, row] of Object.entries(offering)) {
    for (const [column, caller] of [
      [1, "agent"],
      [2, "clock"],
    ] as const) {
      if (row[column] !== "yes") continue;
      const run = caller === "agent" ? "a Run" : "a Brief";

      test(`${tool} answers the ${caller} in ${run}`, async () => {
        const handed: string[] = [];
        const input = (runsWith[tool]?.() ?? {}) as JsonObject;
        scriptModel(
          calling([
            () => [tool, input],
            ([result]) => {
              handed.push(result ?? "");
              return null;
            },
          ]),
        );
        // A Monday, a minute before the Brief's 07:00.
        const context = newContext("2026-11-16T06:59:00.000Z");
        if (caller === "agent") {
          await context.callAny(hand, "send_message", { words: "Go on" });
        } else {
          context.advance(60_000);
          await context.fireAlarm();
        }
        await context.runsEnded();

        // What the model was handed is the registry's answer, never the runtime's word that the
        // tool threw.
        expect(handed).toHaveLength(1);
        const text = handed[0] ?? "";
        const answer = answerIn(text);
        expect(answer, `${tool} handed the ${caller}: ${text}`).toMatchObject({
          ok: expect.any(Boolean),
        });
        if (answer && !answer.ok) expect(TURNED_AWAY).not.toContain(answer.error?.code);
        const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
        const calls = page.items.flatMap((message) =>
          message.from === "agent" ? message.run.calls : [],
        );
        expect(calls.map(({ tool }) => tool)).toEqual([tool]);
        expect(TURNED_AWAY).not.toContain(calls[0]?.result);
      });
    }
  }
});

// The same, for the Deployment tools against their own table. The oracle sees only a Context's
// tables, so a call not offered is seen to change nothing by the list of Contexts after it.

describe("the Deployment tools' offering table", () => {
  for (const [tool, row] of Object.entries(deploymentOffering)) {
    everyCaller.forEach((caller, column) => {
      const offered = row[column] === "yes";

      test(`${tool} is ${offered ? "" : "not "}offered to the ${caller.kind}`, async () => {
        const input = deploymentRunsWith[tool];
        expect(
          input,
          `${tool} needs an input it runs with: add one to deploymentRunsWith in apps/worker/test/offering.ts`,
        ).toBeDefined();
        const deployment = newDeployment();
        const { record: made } = await contextIn(deployment, "Work", {
          time_zone: "Europe/Paris",
        });

        const result = await deployment.callAny(caller, tool, input?.(made.id));

        if (offered) {
          if (!result.ok) expect(["not_offered", "invalid_input"]).not.toContain(result.error.code);
          return;
        }
        expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
        expect(value(await deployment.call(hand, "list_contexts", {})).items).toEqual([made]);
      });
    });
  }

  test("a name no registry has is not offered", async () => {
    const result = await newDeployment().callAny(hand, "no_such_tool", {});

    expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
  });
});
