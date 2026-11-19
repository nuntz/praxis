import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentMessage, MessagesPage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { COMPACTION_SYSTEM } from "../src/compaction.ts";
import { marked } from "./markers.ts";
import { scriptModel, textOf, UNAVAILABLE } from "./model-fake.ts";
import { agent, hand, left, newContext, value } from "./seam.ts";

// The Conversation is compacted as it grows, and Praxis supplies the summary (section 5.5, ADR
// 0016): the model writes it on Praxis's instructions, and Praxis adds the Held Changes still
// waiting itself, named by id. What the summary says is never asserted, only what it is made of.

/** A model with a small context window, so a few long tool results fill it. */
const SMALL = {
  contextWindow: 40_000,
  compaction: { reserveTokens: 16_384, keepRecentTokens: 2_000 },
};

/** The long words of an Entry, a quarter of the small window each time the Agent reads it. */
const LONG = "The boiler again. ".repeat(1_700);

/** What the person asks of the Run. */
const ASKED = "Read it until you are full";

/**
 * A Run that reads a long Entry until the Conversation is compacted, then answers: what the model
 * was asked to summarize, what it was sent once the summary stood in, and the Run's Message.
 */
async function compactedRun(summary: string | ReturnType<typeof fauxAssistantMessage>) {
  const summarized: string[] = [];
  const afterwards: string[] = [];
  const context = newContext();
  const asked = marked(ASKED);
  const entry = value(await context.call(hand, "record_entry", { words: marked(LONG) })).record;
  const mine = value(
    await context.call(hand, "record_entry", { words: marked("Fixed it") }),
  ).record;
  const held = left(
    await context.call(agent, "edit_entry", {
      id: mine.id,
      words: marked("Fixed it, I think"),
      version: 0,
    }),
  ).record;
  scriptModel((request) => {
    const [first] = request.messages;
    if (first?.role === "system" && textOf(first) === COMPACTION_SYSTEM) {
      summarized.push(request.messages.map(textOf).join("\n"));
      return typeof summary === "string" ? fauxAssistantMessage(summary) : summary;
    }
    const all = request.messages.map(textOf).join("\n");
    if (summarized.length > 0) {
      afterwards.push(all);
      return fauxAssistantMessage("Done.");
    }
    return fauxAssistantMessage(fauxToolCall("get_entry", { id: entry.id }), {
      stopReason: "toolUse",
    });
  }, SMALL);

  value(await context.callAny(hand, "send_message", { words: asked }));
  await context.runsEnded();

  const [answer] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
    .items as [AgentMessage];
  return { summarized, afterwards, answer, held, asked };
}

describe("compaction: the summary Praxis supplies", () => {
  test("is written by the model on Praxis's instructions, and carries the Held Changes still waiting by id", async () => {
    const summary = "The person was sorting out the boiler.";
    const { summarized, afterwards, answer, held, asked } = await compactedRun(summary);

    expect(summarized).toHaveLength(1);
    // The model is shown the Conversation to summarize, the Agent's reads included, and the
    // person's words without the bearings each Message carried, which it might restate.
    expect(summarized[0]).toContain("get_entry");
    expect(summarized[0]).toContain(asked);
    expect(summarized[0]).not.toContain("<bearings>");
    expect(afterwards.length).toBeGreaterThan(0);
    const sent = afterwards[0] as string;
    expect(sent).toContain(summary);
    expect(sent).toContain(held.id);
    expect(answer.run.ended).toBe("answered");
  });

  test("counts what writing it cost in the Run's cost", async () => {
    const short = await compactedRun("The person was sorting out the boiler.");
    // Ten thousand tokens more of the model's writing, at ten dollars a million.
    const long = await compactedRun(
      `The person was sorting out the boiler. ${"More of the same. ".repeat(2_222)}`,
    );

    const more = (long.answer.run.cost ?? 0) - (short.answer.run.cost ?? 0);
    expect(more).toBeGreaterThan(0.09);
  });

  test("one the model could not write leaves the Conversation as it was, never the runtime's own summary", async () => {
    const { summarized, afterwards, answer } = await compactedRun(
      fauxAssistantMessage([], { stopReason: "error", errorMessage: UNAVAILABLE }),
    );

    expect(summarized.length).toBeGreaterThan(0);
    for (const sent of afterwards) expect(sent).not.toContain("<summary>");
    expect(answer.run.ended).toBe("answered");
  });
});
