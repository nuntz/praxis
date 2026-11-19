import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { conversationToolNames, offeredTo } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { DIGEST_CHANGES } from "../src/agent.ts";
import { marked } from "./markers.ts";
import { type Offered, offeredIn, scriptModel, textOf } from "./model-fake.ts";
import { agent, connection, hand, left, newContext, value } from "./seam.ts";

// What the Agent is given with each Message it answers, beside the bearings of every Run (section
// 5.2, ADR 0016): the Held Changes still waiting and a bounded digest of what changed since the
// last Message it answered, and nothing else from the Journal.

type Context = ReturnType<typeof newContext>;

/** The Messages the scripted model was sent, as it was shown each, bearings and all. */
function seeing(): string[] {
  const seen: string[] = [];
  scriptModel((context) => {
    seen.push(textOf(context.messages.findLast((message) => message.role === "user")));
    return fauxAssistantMessage("Noted.");
  });
  return seen;
}

/** Send a Message carrying a marker, and wait for its Run to end. */
async function send(context: Context, words: string) {
  value(await context.callAny(hand, "send_message", { words: marked(words) }));
  await context.runsEnded();
}

async function recorded(context: Context, words: string) {
  return value(await context.call(hand, "record_entry", { words })).record;
}

describe("send_message: the digest of what changed since the last Message the Agent answered", () => {
  test("names each change others made since, by caller, tool and record, with none of the words", async () => {
    const seen: string[] = [];
    const agentsWords = marked("The Agent's own note");
    scriptModel((context) => {
      seen.push(textOf(context.messages.findLast((message) => message.role === "user")));
      const last = context.messages.at(-1);
      // The first Run records an Entry of its own, then answers; later Runs only answer.
      return seen.length === 1 && last?.role === "user"
        ? fauxAssistantMessage(fauxToolCall("record_entry", { words: agentsWords }), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("Noted.");
    });
    const context = newContext();
    const before = await recorded(context, marked("Before the first turn"));
    await send(context, "Morning");
    const [own] = value(await context.call(hand, "list_entries", {})).items.filter(
      (entry) => entry.words === agentsWords,
    );
    const byHand = await recorded(context, marked("Written by hand"));
    const task = value(
      await context.call(connection, "add_task", {
        entry_id: byHand.id,
        title: marked("Chase it"),
      }),
    ).record;

    await send(context, "Evening");

    expect(seen).toHaveLength(3);
    const told = seen[2] as string;
    expect(told).toContain(byHand.id);
    expect(told).toContain("record_entry");
    expect(told).toContain(task.id);
    expect(told).toContain('"Claude Code"');
    expect(told).not.toContain(before.id);
    expect(told).not.toContain(own?.id);
    expect(told).not.toContain(byHand.words);
    expect(told).not.toContain(task.title);
  });

  test("is bounded: the newest changes, and where to read the earlier ones from", async () => {
    const seen = seeing();
    const context = newContext();
    await send(context, "Morning");
    const made = [];
    for (let n = 0; n < DIGEST_CHANGES + 3; n++)
      made.push(await recorded(context, marked(`Entry ${n}`)));

    await send(context, "Evening");

    const told = seen[1] as string;
    for (const entry of made.slice(0, 3)) expect(told).not.toContain(entry.id);
    for (const entry of made.slice(3)) expect(told).toContain(entry.id);
    expect(told).toContain("3 earlier changes");
    expect(told).toContain("list_changes");
  });
});

describe("send_message: the first digest, when the Agent was never told what changed", () => {
  test("is of the newest changes, and says it is not since a Message it answered", async () => {
    const seen = seeing();
    const context = newContext();
    const entry = await recorded(context, marked("Written before any Message"));

    await send(context, "Hello");

    expect(seen[0]).toContain(entry.id);
    expect(seen[0]).toMatch(/not been told before/);
    expect(seen[0]).not.toMatch(/since the last Message you answered/);
  });
});

describe("send_message: the Held Changes the Agent is told of", () => {
  test("each one still waiting, by its id and its Entry's, with none of the words", async () => {
    const seen = seeing();
    const context = newContext();
    const before = marked("Called the landlord");
    const entry = await recorded(context, before);
    const after = marked("Called the landlord twice");
    const held = left(
      await context.call(agent, "edit_entry", { id: entry.id, words: after, version: 0 }),
    ).record;

    await send(context, "Anything waiting?");
    value(await context.call(hand, "cancel_held_change", { id: held.id }));
    await send(context, "And now?");

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain(held.id);
    expect(seen[0]).toContain(entry.id);
    expect(seen[0]).not.toContain(before);
    expect(seen[0]).not.toContain(after);
    // Cancelled since, it is no longer waiting, though the digest says it was cancelled.
    expect(seen[1]).not.toContain(`<held_change id="${held.id}"`);
    expect(seen[1]).toContain(`held_change ${held.id}`);
  });
});

/** What the scripted model was offered and told before each Message: its tools and its preamble. */
function offering(): Offered[] {
  const seen: Offered[] = [];
  scriptModel((context) => {
    seen.push(offeredIn(context));
    return fauxAssistantMessage("Noted.");
  });
  return seen;
}

describe("send_message: nothing searches the Conversation", () => {
  test("the Agent is offered its column of Context tools and nothing else: no tool reads Messages", async () => {
    const seen = offering();
    const context = newContext();

    await send(context, "What did I tell you last month?");

    expect(seen).toHaveLength(1);
    expect([...(seen[0]?.tools ?? [])].sort()).toEqual([...offeredTo("agent")].sort());
    for (const tool of conversationToolNames) expect(seen[0]?.tools.has(tool)).toBe(false);
  });
});

describe("send_message: the Markdown the Agent may use", () => {
  test("it is told the set, whether the Message was typed or spoken", async () => {
    const seen = offering();
    const context = newContext();

    await send(context, "Write me a note");
    value(
      await context.callAny(hand, "send_message", { words: marked("And another"), spoken: true }),
    );
    await context.runsEnded();

    expect(seen).toHaveLength(2);
    for (const { preamble } of seen) {
      expect(preamble).toMatch(/Markdown/);
      for (const shown of ["emphasis", "code", "lists", "quotes", "headings", "tables", "images"]) {
        expect(preamble).toContain(shown);
      }
      expect(preamble).toMatch(/strikethrough/);
    }
  });
});
