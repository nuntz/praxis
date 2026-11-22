import { describe, expect, test } from "vitest";
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
