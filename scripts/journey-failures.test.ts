import { expect, test } from "bun:test";
import { failureOf, grouped, slowSteps } from "./journey-failures";

/** The head of an `error-context.md` as Playwright writes it (as seen in the runs under load). */
function errorContext(location: string, error: string): string {
  return [
    "# Instructions",
    "",
    "- Following Playwright test failed.",
    "",
    "# Test info",
    "",
    "- Name: held-changes.spec.ts >> the Agent's change to the person's words waits for their tap",
    `- Location: ${location}`,
    "",
    "# Error details",
    "",
    "```",
    error,
    "",
    "Locator: getByTestId('held-before')",
    "```",
  ].join("\n");
}

test("a failure is read from its folder's name and its error context", () => {
  const failure = failureOf(
    "held-changes-the-Agent-s-c-c014b-or-their-tap-which-makes-it-phone-repeat5",
    errorContext(
      "e2e/held-changes.spec.ts:31:1",
      "Error: expect(locator).toHaveText(expected) failed",
    ),
  );
  expect(failure).toEqual({
    location: "e2e/held-changes.spec.ts:31:1",
    name: "held-changes.spec.ts >> the Agent's change to the person's words waits for their tap",
    project: "phone",
    repeat: 5,
    error: "Error: expect(locator).toHaveText(expected) failed",
  });
});

test("a folder with no repeat in its name is the first repeat", () => {
  const failure = failureOf("spend-the-person-sets-the-desktop", errorContext("a", "b"));
  expect(failure).toMatchObject({ project: "desktop", repeat: 0 });
});

test("failures are grouped by journey and first error, the largest group first", () => {
  const timeout = 'Tearing down "accessible" exceeded the test timeout of 30000ms.';
  const failures = [
    failureOf("spend-desktop-repeat2", errorContext("e2e/spend.spec.ts:11:1", timeout)),
    failureOf("links-phone-repeat3", errorContext("e2e/links.spec.ts:3:1", "Test timeout")),
    failureOf("spend-phone-repeat1", errorContext("e2e/spend.spec.ts:11:1", timeout)),
  ];
  expect(grouped(failures)).toEqual([
    { key: `e2e/spend.spec.ts:11:1  ${timeout}`, repeats: ["desktop:2", "phone:1"] },
    { key: "e2e/links.spec.ts:3:1  Test timeout", repeats: ["phone:3"] },
  ]);
});

test("a trace's slow actions are those that took the least given or never ended, each once", () => {
  const lines = [
    { type: "before", callId: "a", startTime: 1000, title: "goto", params: { url: "/" } },
    {
      type: "before",
      class: "Test",
      method: "pw:api",
      callId: "t",
      startTime: 1000,
      title: "Navigate",
    },
    { type: "after", callId: "t", endTime: 3400 },
    { type: "after", callId: "a", endTime: 3400 },
    { type: "before", callId: "b", startTime: 3500, title: "click", params: { selector: "x" } },
    { type: "after", callId: "b", endTime: 3600 },
    { type: "before", callId: "c", startTime: 4000, title: "reload" },
    "not json",
  ].map((line) => (typeof line === "string" ? line : JSON.stringify(line)));
  expect(slowSteps(lines, 800)).toEqual([
    { at: 0, took: 2400, title: "goto", target: "/" },
    { at: 3000, took: null, title: "reload", target: "" },
  ]);
});
