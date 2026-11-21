import type { MessagesPage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { calling, failing, heldAnswer, scriptModel, UNAVAILABLE } from "./model-fake.ts";
import { contextWithItsDeployment, hand, value } from "./seam.ts";

// Clearing a Conversation (section 5.8, ADR 0010): the person drops all of the runtime's record
// at once, by hand from the Context's settings, and the Journal, the change log and the Run
// records stay as they were.

type Context = Awaited<ReturnType<typeof contextWithItsDeployment>>["context"];

async function messages(context: Context): Promise<MessagesPage> {
  return value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
}

describe("clear_conversation", () => {
  test("drops every Message, and leaves the Journal, the change log and the Run records as they were", async () => {
    scriptModel(calling([() => ["record_entry", { words: marked("Buy bread") }]], marked("Noted")));
    const { context } = await contextWithItsDeployment();
    await context.callAny(hand, "send_message", { words: marked("Remind me to buy bread") });
    await context.runsEnded();
    const journal = value(await context.call(hand, "list_entries", {}));
    const changes = value(await context.call(hand, "list_changes", {}));
    const runs = value(await context.call(hand, "list_runs", {}));

    const cleared = value(await context.call(hand, "clear_conversation", {}));

    expect(cleared).toEqual({ conversation: "cleared" });
    expect(await messages(context)).toEqual({ items: [], next_cursor: null, agent: "available" });
    expect(value(await context.call(hand, "list_entries", {}))).toEqual(journal);
    expect(value(await context.call(hand, "list_changes", {}))).toEqual(changes);
    expect(value(await context.call(hand, "list_runs", {}))).toEqual(runs);
  });

  test("a Message sent after it starts the Conversation afresh, with a Run of its own", async () => {
    const { context } = await contextWithItsDeployment();
    await context.callAny(hand, "send_message", { words: marked("Before") });
    await context.runsEnded();
    const [before] = value(await context.call(hand, "list_runs", {})).items;
    value(await context.call(hand, "clear_conversation", {}));

    // The runtime opened afresh numbers its records from the start again: the change this Run
    // makes is its own, not the earlier Run's.
    scriptModel(calling([() => ["record_entry", { words: marked("Afresh") }]]));
    await context.callAny(hand, "send_message", { words: marked("After") });
    await context.runsEnded();

    const page = await messages(context);
    expect(page.items.map(({ from }) => from)).toEqual(["agent", "person"]);
    const runs = value(await context.call(hand, "list_runs", {})).items;
    expect(runs).toHaveLength(2);
    const [entry] = value(await context.call(hand, "list_entries", {})).items;
    expect(runs[0]).toMatchObject({
      ended: "answered",
      changes: [{ tool: "record_entry", changed: [{ kind: "entry", id: entry?.id }] }],
    });
    expect(runs[0]?.id).not.toBe(before?.id);
    expect(runs[1]).toEqual(before);
    expect(page.items[0]).toMatchObject({ from: "agent", run: { id: runs[0]?.id } });
  });

  test("a Run that failed before it cannot be tried again: its Message is gone", async () => {
    scriptModel(failing(UNAVAILABLE));
    const { context } = await contextWithItsDeployment();
    await context.callAny(hand, "send_message", { words: marked("Hello?") });
    await context.runsEnded();
    const [failed] = value(await context.call(hand, "list_runs", {})).items;
    expect(failed).toMatchObject({ ended: "failed" });
    value(await context.call(hand, "clear_conversation", {}));

    const retried = await context.callAny(hand, "retry_run", { run: failed?.id });

    expect(retried).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("is refused while a Run is going, with nothing dropped", async () => {
    const { script, answer } = heldAnswer();
    scriptModel(script);
    const { context } = await contextWithItsDeployment();
    value(await context.callAny(hand, "send_message", { words: marked("Hello") }));

    const refused = await context.call(hand, "clear_conversation", {});

    expect(refused).toMatchObject({ ok: false, error: { code: "refused", in_the_way: [] } });
    answer();
    await context.runsEnded();
    expect((await messages(context)).items.map(({ from }) => from)).toEqual(["agent", "person"]);
  });

  test("a Conversation never opened holds nothing, and is cleared all the same", async () => {
    const { context } = await contextWithItsDeployment();

    expect(value(await context.call(hand, "clear_conversation", {}))).toEqual({
      conversation: "cleared",
    });
    expect(await messages(context)).toEqual({ items: [], next_cursor: null, agent: "available" });
  });
});
