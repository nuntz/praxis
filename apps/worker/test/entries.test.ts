import { describe, expect, test } from "vitest";
import { marked, marker } from "./markers.ts";
import {
  agent,
  clock,
  connection,
  everyCaller,
  hand,
  newContext,
  readOnlyConnection,
  value,
} from "./seam.ts";

describe("record_entry", () => {
  test("the person's words are kept exactly as typed, at the time they arrived, with the person as Author", async () => {
    const context = newContext("2026-11-15T09:30:00.000Z");
    const words = `  Called Ali ${marker()} about the lease.\r\n\tStill no answer 🙃  \n`;

    const { record } = value(await context.call(hand, "record_entry", { words }));

    expect(record).toEqual({
      id: expect.any(String),
      words,
      at: "2026-11-15T09:30:00.000Z",
      author: { kind: "person" },
      through_conversation: false,
      tasks: [],
      links: [],
      version: 0,
      edited: null,
      follow_up_to: null,
      follow_ups: [],
    });
    expect(value(await context.call(hand, "get_entry", { id: record.id }))).toEqual(record);
  });

  test("a Connection is stamped as the Author by its name", async () => {
    const context = newContext();

    const { record } = value(
      await context.call(connection, "record_entry", { words: marked("Outside agent's") }),
    );

    expect(record.author).toEqual({ kind: "connection", name: "Claude Code" });
    expect(record.through_conversation).toBe(false);
  });

  test("an Entry the Agent records came through the Conversation", async () => {
    // Who is its Author (the person, for their words verbatim, or the Agent, for prose it was
    // asked to compose) is settled with the Agent's Runs.
    const context = newContext();

    const { record } = value(
      await context.call(agent, "record_entry", { words: marked("Said aloud") }),
    );

    expect(record.through_conversation).toBe(true);
  });

  test("a caller cannot state the Author or the time", async () => {
    const context = newContext();

    for (const input of [
      { words: marked("Mine"), author: { kind: "agent" } },
      { words: marked("Mine"), at: "2020-01-01T00:00:00.000Z" },
    ]) {
      const result = await context.call(hand, "record_entry", input);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual([]);
  });

  test("an Entry needs words", async () => {
    const context = newContext();

    const result = await context.call(hand, "record_entry", { words: " \n " });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual([]);
  });

  test("the Clock and a Read-only Connection are not offered it", async () => {
    const context = newContext();

    for (const caller of [clock, readOnlyConnection]) {
      const result = await context.call(caller, "record_entry", { words: marked("Nope") });
      expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
    }
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual([]);
  });
});

describe("get_entry", () => {
  test("is offered to every caller", async () => {
    const context = newContext();
    const { record } = value(
      await context.call(hand, "record_entry", { words: marked("Read me") }),
    );

    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "get_entry", { id: record.id }))).toEqual(record);
    }
  });

  test("an Entry that is not in this Context is not found", async () => {
    const context = newContext();
    const elsewhere = newContext();
    const { record } = value(
      await elsewhere.call(hand, "record_entry", { words: marked("Elsewhere") }),
    );

    const result = await context.call(hand, "get_entry", { id: record.id });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("a tool the registry does not have", () => {
  test("is not offered", async () => {
    const result = await newContext().callAny(hand, "no_such_tool", { title: "Nothing" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
  });
});

describe("list_entries", () => {
  test("lists the Journal newest first, 50 to a page, and a cursor reaches the rest", async () => {
    const context = newContext("2026-11-01T08:00:00.000Z");
    const recorded: string[] = [];
    for (let n = 1; n <= 53; n++) {
      recorded.push(marked(`Entry ${n}`));
      value(await context.call(hand, "record_entry", { words: recorded.at(-1) }));
      context.advance(60_000);
    }
    const newestFirst = recorded.toReversed();

    const first = value(await context.call(hand, "list_entries", {}));
    expect(first.items.map((entry) => entry.words)).toEqual(newestFirst.slice(0, 50));
    expect(first.next_cursor).toEqual(expect.any(String));

    const second = value(await context.call(hand, "list_entries", { cursor: first.next_cursor }));
    expect(second.items.map((entry) => entry.words)).toEqual(newestFirst.slice(50));
    expect(second.next_cursor).toBeNull();
  });

  test("Entries that arrive at the same instant keep the order they arrived in", async () => {
    const context = newContext();
    const [first, second, third] = [marked("First"), marked("Second"), marked("Third")];
    for (const words of [first, second, third]) {
      value(await context.call(hand, "record_entry", { words }));
    }

    const { items } = value(await context.call(connection, "list_entries", {}));

    expect(items.map((entry) => entry.words)).toEqual([third, second, first]);
  });

  test("a cursor this list did not give is invalid input", async () => {
    const result = await newContext().call(hand, "list_entries", { cursor: "not-a-cursor" });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("record_entry's Follow-up", () => {
  test("names the one earlier Entry it continues or corrects, and that Entry is read with its Follow-ups", async () => {
    const context = newContext();
    const earlier = value(
      await context.call(hand, "record_entry", { words: marked("Quote from the roofer") }),
    ).record;
    expect(earlier.follow_up_to).toBeNull();
    expect(earlier.follow_ups).toEqual([]);

    const first = value(
      await context.call(hand, "record_entry", {
        words: marked("The quote was wrong"),
        follow_up_to: earlier.id,
      }),
    );
    const second = value(
      await context.call(connection, "record_entry", {
        words: marked("A new quote came"),
        follow_up_to: earlier.id,
      }),
    ).record;

    expect(first.record.follow_up_to).toEqual({ id: earlier.id, summary: earlier.words });
    // The earlier Entry is not changed by it: a Follow-up is the later Entry's own.
    expect(first.effects).toEqual([
      { kind: "entry", id: first.record.id, what: "made", summary: first.record.words, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_entry", { id: earlier.id })).follow_ups).toEqual([
      { id: first.record.id, summary: first.record.words },
      { id: second.id, summary: second.words },
    ]);
  });

  test("names at most one Entry", async () => {
    const context = newContext();
    const [a, b] = [
      value(await context.call(hand, "record_entry", { words: marked("A") })).record,
      value(await context.call(hand, "record_entry", { words: marked("B") })).record,
    ];

    const result = await context.call(hand, "record_entry", {
      words: marked("Both"),
      follow_up_to: [a.id, b.id],
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("naming an Entry not in this Context keeps the words, with no Follow-up", async () => {
    const context = newContext();
    const elsewhere = value(
      await newContext().call(hand, "record_entry", { words: marked("Elsewhere") }),
    ).record;

    const { record } = value(
      await context.call(hand, "record_entry", {
        words: marked("Here"),
        follow_up_to: elsewhere.id,
      }),
    );

    expect(record.follow_up_to).toBeNull();
  });
});
