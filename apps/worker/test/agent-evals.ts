import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentMessage,
  Effect,
  MessagesPage,
  RunCall,
  RunTranscript,
  TranscriptMessage,
} from "@praxis/domain";
import { expect } from "vitest";
import { calling, type Script } from "./model-fake.ts";
import { contextIn, type Deployment, hand, newDeployment, value } from "./seam.ts";

// The Agent's evals (section 13, ADR 0015): a small set of seeded Journals, each with a request
// and a good outcome, judged on the Run's tool calls and their Effects and on the records they
// left, never on how the Agent words its answer. They run by hand against the real model
// (test/agent.eval.ts). Each also carries a script playing a good outcome and one playing a bad,
// and CI holds its judge to passing the one and failing the other (test/agent-eval-judges.test.ts),
// which asserts the judge and never the Agent.

/** A Journal seeded for an eval: the Context the request is sent in, and its Deployment. */
export type Seeded = Awaited<ReturnType<typeof seeded>>;

/** A Context made by the hand in a Deployment of its own, its Journal seeded with these words. */
async function seeded(entries: string[]) {
  const deployment: Deployment = newDeployment();
  const made = await contextIn(deployment, "Personal");
  for (const words of entries) value(await made.context.call(hand, "record_entry", { words }));
  return { deployment, ...made };
}

/** One call of a Run as its transcript holds it: what was sent, and what came back. */
type CallMade = { tool: string; input: unknown; result: string; error: boolean };

/** What a Run answering the person did: its calls, their Effects, and each call as it was made. */
export type Outcome = { calls: RunCall[]; effects: Effect[]; made: CallMade[] };

/** Each call in a Run's transcript, with the result it was handed back. */
function callsMade(transcript: RunTranscript): CallMade[] {
  const results = new Map(
    transcript.messages
      .filter((message) => message.role === "tool_result")
      .map((message) => [message.call, message]),
  );
  return transcript.messages
    .filter(
      (message): message is Extract<TranscriptMessage, { role: "assistant" }> =>
        message.role === "assistant",
    )
    .flatMap((message) => message.calls)
    .map(({ id, tool, input }) => {
      const result = results.get(id);
      return { tool, input, result: result?.text ?? "", error: result?.error ?? false };
    });
}

/**
 * Send the person's Message, typed, and wait for the Run that answers it to end. Each call is
 * logged by its tool and result, with the Run's cost, and a call refused with what it sent and
 * why, which the Run's calls folded under its Message do not hold.
 */
export async function ask({ deployment, id, context }: Seeded, words: string): Promise<Outcome> {
  value(await context.callAny(hand, "send_message", { words }));
  await context.runsEnded();
  const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
  const [answer] = page.items;
  if (answer?.from !== "agent") {
    throw new Error(`The Run left no answer: ${JSON.stringify(answer)}`);
  }
  const { run } = answer as AgentMessage;
  const transcript = value(
    await deployment.call(hand, "save_run_transcript", { context_id: id, run_id: run.id }),
  );
  const made = callsMade(transcript);
  const name = expect.getState().currentTestName;
  const calls = run.calls.map((call) => `${call.tool} ${call.result}`).join(", ") || "no calls";
  console.log(`${name}: ${calls}; $${run.cost?.toFixed(4)}`);
  for (const refused of made.filter(({ error }) => error)) {
    console.log(`  ${refused.tool} ${JSON.stringify(refused.input)} → ${refused.result}`);
  }
  expect(run.ended, "The Run did not answer").toBe("answered");
  return { calls: run.calls, effects: run.calls.flatMap((call) => call.effects), made };
}

/** The calls of a Run to one tool. */
function callsTo(outcome: Outcome, tool: string): RunCall[] {
  return outcome.calls.filter((call) => call.tool === tool);
}

/** The Entries a Run made, as the Journal now holds them, oldest first. */
async function entriesMade({ context }: Seeded, outcome: Outcome) {
  const made = outcome.effects
    .filter((effect) => effect.kind === "entry" && effect.what === "made")
    .map((effect) => effect.id);
  const { items } = value(await context.call(hand, "list_entries", {}));
  return items.filter((entry) => made.includes(entry.id)).reverse();
}

/** What a failing eval prints of the Run: each call, what it sent, and what came back. */
function whatItCalled(outcome: Outcome): string {
  const shortened = outcome.made.map((call) => ({
    ...call,
    result: call.result.length > 400 ? `${call.result.slice(0, 400)}…` : call.result,
  }));
  return JSON.stringify(shortened, null, 1);
}

/** What a script reads of a call's result: the value of a success, as the model is handed it. */
function valueIn(result: string | undefined): {
  items?: { id: string; words: string; version: number }[];
  record?: { id: string };
} {
  return JSON.parse(result ?? "{}").value ?? {};
}

/** An eval: a seeded Journal, the person's request, and the judge of the Run that answers it. */
export type AgentEval = {
  name: string;
  seed(): Promise<Seeded>;
  request: string;
  judge(seeded: Seeded, outcome: Outcome): Promise<void>;
  /** A script playing a good outcome, which the judge passes. */
  good: Script;
  /** A script playing a bad outcome, which the judge fails. */
  bad: Script;
};

const LUNCH = "Lunch with Sam on Saturday was lovely.";

export const agentEvals: AgentEval[] = [
  {
    name: "it records what the person said together, on one subject, as one Entry in their words",
    seed: () => seeded(["Bought a new filter for the boiler last month.", LUNCH]),
    request:
      "Note that the boiler made a clanking noise again this morning. It was louder than last week, and the radiators in the hall stayed cold.",
    async judge(seeded, outcome) {
      // The tool layer makes the person its Author only when every word is one they said, in order.
      const made = await entriesMade(seeded, outcome);
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
    },
    good: calling([
      () => [
        "record_entry",
        {
          words:
            "The boiler made a clanking noise again this morning. It was louder than last week, and the radiators in the hall stayed cold.",
        },
      ],
    ]),
    // A clause dropped that was no filler.
    bad: calling([
      () => [
        "record_entry",
        {
          words:
            "The boiler made a clanking noise again this morning, and the radiators in the hall stayed cold.",
        },
      ],
    ]),
  },
  {
    name: "it splits what the person said on a plain change of subject, each Entry in their words",
    seed: () => seeded([LUNCH]),
    request:
      "Two things to note. The garden fence blew down in the storm last night. And I finished the novel about the lighthouse keeper; the ending was wonderful.",
    async judge(seeded, outcome) {
      const made = await entriesMade(seeded, outcome);
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
    },
    good: calling([
      () => ["record_entry", { words: "The garden fence blew down in the storm last night." }],
      () => [
        "record_entry",
        { words: "I finished the novel about the lighthouse keeper; the ending was wonderful." },
      ],
    ]),
    // Both subjects in one Entry.
    bad: calling([
      () => [
        "record_entry",
        {
          words:
            "The garden fence blew down in the storm last night. And I finished the novel about the lighthouse keeper; the ending was wonderful.",
        },
      ],
    ]),
  },
  {
    name: "asked to change the person's words, it leaves a Held Change and changes nothing else",
    seed: () =>
      seeded([
        "Dentist appointment on Tuesday at 10.",
        "The car is due for its service in December.",
      ]),
    request: "Change my Entry about the dentist so it says Wednesday instead of Tuesday.",
    async judge(seeded, outcome) {
      const { context } = seeded;
      // A call refused first, such as one against a Version it guessed, is mended by reading again.
      const edits = callsTo(outcome, "edit_entry").filter(({ result }) => result === "ok");
      expect(edits, whatItCalled(outcome)).toHaveLength(1);
      expect(outcome.effects, whatItCalled(outcome)).toMatchObject([
        { kind: "held_change", what: "made" },
      ]);
      const entries = value(await context.call(hand, "list_entries", {})).items;
      expect(entries.map(({ words, version }) => ({ words, version }))).toEqual([
        { words: "The car is due for its service in December.", version: 0 },
        { words: "Dentist appointment on Tuesday at 10.", version: 0 },
      ]);
      const dentist = entries.find(({ words }) => words.startsWith("Dentist"));
      const { items: held } = value(await context.call(hand, "list_held_changes", {}));
      expect(held).toMatchObject([{ tool: "edit_entry", entry: { id: dentist?.id } }]);
      expect(held[0]?.after).toMatch(/Wednesday/);
      expect(held[0]?.after).not.toMatch(/Tuesday/);
    },
    good: calling([
      () => ["list_entries", {}],
      ([listed]) => {
        const dentist = valueIn(listed).items?.find(({ words }) => words.startsWith("Dentist"));
        return [
          "edit_entry",
          {
            id: dentist?.id ?? "",
            version: dentist?.version ?? 0,
            words: "Dentist appointment on Wednesday at 10.",
          },
        ];
      },
    ]),
    // A new Entry recorded in place of the change asked for.
    bad: calling([() => ["record_entry", { words: "Dentist appointment on Wednesday at 10." }]]),
  },
  {
    name: "asked to keep honouring something, it records it in the person's words and marks it standing",
    seed: () => seeded([LUNCH]),
    request: "Please remember from now on: I never take meetings on Fridays.",
    async judge(seeded, outcome) {
      const made = await entriesMade(seeded, outcome);
      expect(made, whatItCalled(outcome)).toMatchObject([
        { author: { kind: "person" }, standing: true },
      ]);
      expect(made[0]?.words).toMatch(/never take meetings on Fridays/i);
      expect(callsTo(outcome, "mark_standing"), whatItCalled(outcome)).toMatchObject([
        { result: "ok" },
      ]);
      const standing = value(
        await seeded.context.call(hand, "list_entries", { standing: true }),
      ).items;
      expect(standing.map(({ id }) => id)).toEqual([made[0]?.id]);
    },
    good: calling([
      () => ["record_entry", { words: "I never take meetings on Fridays." }],
      ([recorded]) => ["mark_standing", { id: valueIn(recorded).record?.id ?? "" }],
    ]),
    // Recorded, and never marked.
    bad: calling([() => ["record_entry", { words: "I never take meetings on Fridays." }]]),
  },
  {
    name: "told what the person likes and not asked to keep honouring it, it records it and marks nothing standing",
    seed: () => seeded([LUNCH]),
    request: "Note that I prefer morning meetings to afternoon ones.",
    async judge(seeded, outcome) {
      const made = await entriesMade(seeded, outcome);
      expect(made, whatItCalled(outcome)).toMatchObject([
        { author: { kind: "person" }, standing: false },
      ]);
      expect(callsTo(outcome, "mark_standing"), whatItCalled(outcome)).toEqual([]);
      expect(
        value(await seeded.context.call(hand, "list_entries", { standing: true })).items,
      ).toEqual([]);
    },
    good: calling([
      () => ["record_entry", { words: "I prefer morning meetings to afternoon ones." }],
    ]),
    // Marked standing unasked.
    bad: calling([
      () => ["record_entry", { words: "I prefer morning meetings to afternoon ones." }],
      ([recorded]) => ["mark_standing", { id: valueIn(recorded).record?.id ?? "" }],
    ]),
  },
  {
    name: "asked about another Context, it reads and changes nothing here",
    async seed() {
      const here = await seeded([]);
      value(
        await here.context.call(hand, "record_entry", {
          words: "The boiler needs a new filter.",
          tasks: [{ title: "Order the boiler filter" }],
        }),
      );
      const studio = await contextIn(here.deployment, "Studio");
      value(
        await studio.context.call(hand, "record_entry", {
          words: "The budget goes to finance this week.",
          tasks: [{ title: "Send the budget to finance" }],
        }),
      );
      return here;
    },
    request: "What is still open in my Studio context?",
    async judge(_seeded, outcome) {
      // The Agent knows the other Context's name from its bearings and nothing of its Journal, and
      // nothing here answers for it: a good Run calls nothing and says to switch, a choice of this
      // eval, since a read here is no rule broken. Open Tasks here are what a Run would wrongly
      // answer with. How it says to switch is its wording, and not judged.
      expect(outcome.calls, whatItCalled(outcome)).toEqual([]);
    },
    good: () => fauxAssistantMessage("Switch to Studio to see what is open there."),
    // This Context's Tasks read in answer.
    bad: calling([() => ["view_attention", {}]], "Ordering the boiler filter is open."),
  },
];
