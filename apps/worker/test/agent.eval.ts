import type { AgentMessage, Effect, MessagesPage, RunCall } from "@praxis/domain";
import { beforeEach, describe, expect, inject, test } from "vitest";
import { anthropicModel } from "../src/model.ts";
import { useModel } from "./model-fake.ts";
import { contextIn, hand, newDeployment, value } from "./seam.ts";

// The Agent's evals (section 13, ADR 0015): a small set of seeded Journals, each with a request
// and a good outcome, judged on the Run's tool calls and their Effects and on the records they
// left, never on how the Agent words its answer. Run by hand, against the real model with the
// person's own key, whenever the prompt (src/agent.ts), the tools' descriptions or the model
// changes:
//
//   AGENT_API_KEY=… [AGENT_MODEL=…] bun run evals
//
// CI never runs them (vitest.evals.config.ts). Each eval runs once, so a model that passes one
// only sometimes shows it over a few runs. A failure says what the Run called; file it as a
// ticket with the date, the model and the commit.

const real = inject("realModel");
if (!real) throw new Error("The evals run on the real model only: `bun run evals`");
const configured = anthropicModel({ AGENT_API_KEY: real.key, AGENT_MODEL: real.model });
if (typeof configured === "string") throw new Error(`No model to run the evals on: ${configured}`);
const model = configured;

beforeEach(() => useModel(model));

/** A Context made by the hand in a Deployment of its own, its Journal seeded with these words. */
async function seeded(entries: string[]) {
  const deployment = newDeployment();
  const made = await contextIn(deployment, "Personal");
  for (const words of entries) value(await made.context.call(hand, "record_entry", { words }));
  return { deployment, ...made };
}

type Reached = Awaited<ReturnType<typeof seeded>>["context"];

/** What a Run answering the person did: its calls and their Effects. */
type Outcome = { calls: RunCall[]; effects: Effect[] };

/** Send the person's Message, typed, and wait for the Run that answers it to end. */
async function ask(context: Reached, words: string): Promise<Outcome> {
  value(await context.callAny(hand, "send_message", { words }));
  await context.runsEnded();
  const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
  const [answer] = page.items;
  if (answer?.from !== "agent") {
    throw new Error(`The Run left no answer: ${JSON.stringify(answer)}`);
  }
  const { run } = answer as AgentMessage;
  console.log(
    `${expect.getState().currentTestName}: ${run.calls.map((call) => `${call.tool} ${call.result}`).join(", ") || "no calls"}; $${run.cost?.toFixed(4)}`,
  );
  expect(run.ended, "The Run did not answer").toBe("answered");
  return { calls: run.calls, effects: run.calls.flatMap((call) => call.effects) };
}

/** The calls of a Run to one tool. */
function callsTo(outcome: Outcome, tool: string): RunCall[] {
  return outcome.calls.filter((call) => call.tool === tool);
}

/** The Entries a Run made, as the Journal now holds them, oldest first. */
async function entriesMade(context: Reached, outcome: Outcome) {
  const made = outcome.effects
    .filter((effect) => effect.kind === "entry" && effect.what === "made")
    .map((effect) => effect.id);
  const { items } = value(await context.call(hand, "list_entries", {}));
  return items.filter((entry) => made.includes(entry.id)).reverse();
}

/** What a failing eval prints of the Run, so the failure says what the Agent did. */
function whatItCalled(outcome: Outcome): string {
  return JSON.stringify(outcome.calls, null, 1);
}

describe("the Agent's evals", () => {
  test("it records what the person said together, on one subject, as one Entry in their words", async () => {
    const { context } = await seeded([
      "Bought a new filter for the boiler last month.",
      "Lunch with Sam on Saturday was lovely.",
    ]);

    const outcome = await ask(
      context,
      "Note that the boiler made a clanking noise again this morning. It was louder than last week, and the radiators in the hall stayed cold.",
    );

    // The tool layer makes the person its Author only when every word is one they said, in order.
    const made = await entriesMade(context, outcome);
    expect(made, whatItCalled(outcome)).toMatchObject([
      { author: { kind: "person" }, standing: false },
    ]);
    // Every clause is kept, in order, and nothing is added to them, Markdown included.
    expect(made[0]?.words).toMatch(
      /boiler made a clanking noise again this morning\W+it was louder than last week\W+and the radiators in the hall stayed cold\W*$/i,
    );
    expect(made[0]?.words).not.toMatch(/[*_`#>[\]]|^\s*([-+]|\d+\.)\s/m);
    expect(outcome.effects, whatItCalled(outcome)).toMatchObject([
      { kind: "entry", id: made[0]?.id, what: "made" },
    ]);
  });

  test("it splits what the person said on a plain change of subject, each Entry in their words", async () => {
    const { context } = await seeded(["Lunch with Sam on Saturday was lovely."]);

    const outcome = await ask(
      context,
      "Two things to note. The garden fence blew down in the storm last night. And I finished the novel about the lighthouse keeper; the ending was wonderful.",
    );

    const made = await entriesMade(context, outcome);
    expect(made, whatItCalled(outcome)).toMatchObject([
      { author: { kind: "person" } },
      { author: { kind: "person" } },
    ]);
    const subjects = made.map(({ words }) => [/fence/.test(words), /lighthouse/.test(words)]);
    expect(subjects.toSorted(), "Each subject is in one Entry, alone").toEqual([
      [false, true],
      [true, false],
    ]);
    expect(
      outcome.effects.every((effect) => effect.kind === "entry" && effect.what === "made"),
      whatItCalled(outcome),
    ).toBe(true);
  });

  test("asked to change the person's words, it leaves a Held Change and changes nothing else", async () => {
    const { context } = await seeded([
      "Dentist appointment on Tuesday at 10.",
      "The car is due for its service in December.",
    ]);
    const before = value(await context.call(hand, "list_entries", {})).items;

    const outcome = await ask(
      context,
      "Change my Entry about the dentist so it says Wednesday instead of Tuesday.",
    );

    // A call refused first, such as one against a Version it guessed, is mended by reading again.
    const edits = callsTo(outcome, "edit_entry").filter(({ result }) => result === "ok");
    expect(edits, whatItCalled(outcome)).toHaveLength(1);
    expect(outcome.effects, whatItCalled(outcome)).toMatchObject([
      { kind: "held_change", what: "made" },
    ]);
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual(before);
    const dentist = before.find(({ words }) => words.startsWith("Dentist"));
    const { items: held } = value(await context.call(hand, "list_held_changes", {}));
    expect(held).toMatchObject([{ tool: "edit_entry", entry: { id: dentist?.id } }]);
    expect(held[0]?.after).toMatch(/Wednesday/);
    expect(held[0]?.after).not.toMatch(/Tuesday/);
  });

  test("asked to keep honouring something, it records it in the person's words and marks it standing", async () => {
    const { context } = await seeded(["Lunch with Sam on Saturday was lovely."]);

    const outcome = await ask(
      context,
      "Please remember from now on: I never take meetings on Fridays.",
    );

    const made = await entriesMade(context, outcome);
    expect(made, whatItCalled(outcome)).toMatchObject([
      { author: { kind: "person" }, standing: true },
    ]);
    expect(made[0]?.words).toMatch(/never take meetings on Fridays/i);
    expect(callsTo(outcome, "mark_standing"), whatItCalled(outcome)).toMatchObject([
      { result: "ok" },
    ]);
    const standing = value(await context.call(hand, "list_entries", { standing: true })).items;
    expect(standing.map(({ id }) => id)).toEqual([made[0]?.id]);
  });

  test("told what the person likes and not asked to keep honouring it, it records it and marks nothing standing", async () => {
    const { context } = await seeded(["Lunch with Sam on Saturday was lovely."]);

    const outcome = await ask(context, "Note that I prefer morning meetings to afternoon ones.");

    const made = await entriesMade(context, outcome);
    expect(made, whatItCalled(outcome)).toMatchObject([
      { author: { kind: "person" }, standing: false },
    ]);
    expect(callsTo(outcome, "mark_standing"), whatItCalled(outcome)).toEqual([]);
    expect(value(await context.call(hand, "list_entries", { standing: true })).items).toEqual([]);
  });

  test("asked about another Context, it reads and changes nothing here", async () => {
    const { deployment, context } = await seeded([]);
    value(
      await context.call(hand, "record_entry", {
        words: "The boiler needs a new filter.",
        tasks: [{ title: "Order the boiler filter" }],
      }),
    );
    const work = await contextIn(deployment, "Studio");
    value(
      await work.context.call(hand, "record_entry", {
        words: "The budget goes to finance this week.",
        tasks: [{ title: "Send the budget to finance" }],
      }),
    );

    const outcome = await ask(context, "What is still open in my Studio context?");

    // The Agent knows the other Context's name from its bearings and nothing of its Journal, and
    // nothing here answers for it: a good Run calls nothing and says to switch, a choice of this
    // eval, since a read here is no rule broken. Open Tasks here are what a Run would wrongly
    // answer with. How it says to switch is its wording, and not judged.
    expect(outcome.calls, whatItCalled(outcome)).toEqual([]);
  });
});
