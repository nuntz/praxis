import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, atOnce, connection, DAY, everyCaller, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** An Entry recorded by this caller, as the write returned it. */
async function recorded(context: Context, words: string, caller = hand) {
  return value(await context.call(caller, "record_entry", { words })).record;
}

describe("edit_entry", () => {
  test("changes the words, keeping the words before as a Version with who changed them and when", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const first = marked("Called the landlord");
    const entry = await recorded(context, first);
    expect(entry.version).toBe(0);
    expect(entry.edited).toBeNull();

    context.advance(DAY);
    const second = marked("Called the landlord twice");
    const result = value(
      await context.call(hand, "edit_entry", { id: entry.id, words: second, version: 0 }),
    );

    expect(result.record).toEqual({
      ...entry,
      words: second,
      version: 1,
      edited: { by: { kind: "person" }, at: "2026-11-16T09:00:00.000Z" },
    });
    // The Version is part of the Entry: the Entry is the one record changed.
    expect(result.effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: second, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(result.record);
    expect(value(await context.call(hand, "list_entry_versions", { id: entry.id }))).toEqual({
      items: [
        {
          version: 0,
          words: first,
          changed: { by: { kind: "person" }, at: "2026-11-16T09:00:00.000Z" },
        },
      ],
      next_cursor: null,
    });
  });

  test("every saved change keeps a Version, with no coalescing, however close together", async () => {
    const context = newContext();
    const words = [marked("One"), marked("Two"), marked("Three"), marked("Four")];
    const entry = await recorded(context, words[0] as string);

    for (const [version, next] of words.slice(1).entries()) {
      value(await context.call(hand, "edit_entry", { id: entry.id, words: next, version }));
    }

    const { items } = value(await context.call(hand, "list_entry_versions", { id: entry.id }));
    expect(items.map((each) => [each.version, each.words])).toEqual([
      [2, words[2]],
      [1, words[1]],
      [0, words[0]],
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toMatchObject({
      words: words[3],
      version: 3,
    });
  });

  test("a change against a Version no longer current is stale, and changes nothing", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Draft"));
    const now = value(
      await context.call(hand, "edit_entry", { id: entry.id, words: marked("Mine"), version: 0 }),
    ).record;

    const result = await context.call(hand, "edit_entry", {
      id: entry.id,
      words: marked("Theirs"),
      version: 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "stale" } });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(now);
  });

  test("the words it already has change nothing and keep no Version, whatever version is stated", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Unchanged"));
    const now = atOnce(
      await context.call(hand, "edit_entry", { id: entry.id, words: marked("Now"), version: 0 }),
    ).record;

    const result = atOnce(
      await context.call(hand, "edit_entry", { id: entry.id, words: now.words, version: 0 }),
    );

    expect(result).toEqual({ record: now, effects: [], changed: false });
    expect(
      value(await context.call(hand, "list_entry_versions", { id: entry.id })).items,
    ).toHaveLength(1);
  });

  test("the same words with no Task to make keep no Version", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Unchanged"));

    const result = value(
      await context.call(hand, "edit_entry", { id: entry.id, words: entry.words, version: 0 }),
    );

    expect(result).toEqual({ record: entry, effects: [], changed: false });
    expect(value(await context.call(hand, "list_entry_versions", { id: entry.id })).items).toEqual(
      [],
    );
  });

  test("an Entry the person edits becomes theirs", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("From outside"), connection);
    expect(entry.author).toEqual({ kind: "connection", name: "Claude Code" });

    const { record } = atOnce(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("Mine now"),
        version: 0,
      }),
    );

    expect(record.author).toEqual({ kind: "person" });
    expect(record.edited?.by).toEqual({ kind: "person" });
  });

  test("an Entry that is not the person's is changed at once by the Agent or a Connection, and stays its Author's", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Composed"), agent);

    const byConnection = atOnce(
      await context.call(connection, "edit_entry", {
        id: entry.id,
        words: marked("Amended outside"),
        version: 0,
      }),
    ).record;
    const byAgent = atOnce(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: marked("Amended again"),
        version: 1,
      }),
    ).record;

    expect(byConnection.author).toEqual({ kind: "agent" });
    expect(byConnection.edited?.by).toEqual({ kind: "connection", name: "Claude Code" });
    expect(byAgent.author).toEqual({ kind: "agent" });
    expect(byAgent.edited?.by).toEqual({ kind: "agent" });
  });

  test("a Connection is refused the person's words, and told to add a Follow-up or ask the person", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("The person's own"));

    const result = await context.call(connection, "edit_entry", {
      id: entry.id,
      words: marked("Overwritten"),
      version: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "held", message: expect.stringMatching(/Follow-up.*ask the person/s) },
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
  });

  test("the Agent's change to the person's words leaves a Held Change, and nothing else changes", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("The person's own"));

    const result = value(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: marked("Rewritten"),
        version: 0,
      }),
    );

    expect(result).toMatchObject({
      held: true,
      record: { tool: "edit_entry", entry: { id: entry.id } },
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
  });

  test("makes the Tasks it is given, each with the Entry as its Origin Entry", async () => {
    const context = newContext();
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("Lease\n[] Sign it"),
        tasks: [{ title: "Sign it" }],
      }),
    ).record;
    const signIt = entry.tasks[0];

    const words = `${entry.words}\n[] Send it back`;
    const result = atOnce(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words,
        version: 0,
        tasks: [{ title: "Send it back" }],
      }),
    );

    const sendIt = result.record.tasks[1];
    expect(result.record.tasks).toEqual([
      signIt,
      expect.objectContaining({ title: "Send it back", origin_entry: entry.id }),
    ]);
    expect(result.effects).toEqual([
      {
        kind: "entry",
        id: entry.id,
        what: "changed",
        summary: entry.words.split("\n")[0],
        by: "call",
      },
      { kind: "task", id: sendIt?.id, what: "made", summary: "Send it back", by: "call" },
    ]);
  });

  test("words that lose an Inline Task's line delete no Task", async () => {
    const context = newContext();
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("Lease\n[] Sign it"),
        tasks: [{ title: "Sign it" }],
      }),
    ).record;

    const { record } = atOnce(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("Lease"),
        version: 0,
      }),
    );

    expect(record.tasks).toEqual(entry.tasks);
  });

  test("an Entry that is not in this Context is not found", async () => {
    const context = newContext();
    const elsewhere = await recorded(newContext(), marked("Elsewhere"));

    const result = await context.call(hand, "edit_entry", {
      id: elsewhere.id,
      words: marked("Here"),
      version: 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("needs words", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Something"));

    const result = await context.call(hand, "edit_entry", { id: entry.id, words: " ", version: 0 });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("restore_entry_version", () => {
  test("puts back a Version's words as a new change, and the words it replaced become a Version", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [first, second] = [marked("First"), marked("Second")];
    const entry = await recorded(context, first);
    value(await context.call(hand, "edit_entry", { id: entry.id, words: second, version: 0 }));

    context.advance(DAY);
    const result = value(
      await context.call(hand, "restore_entry_version", { id: entry.id, restore: 0, version: 1 }),
    );

    expect(result.record).toMatchObject({
      words: first,
      version: 2,
      edited: { by: { kind: "person" }, at: "2026-11-16T09:00:00.000Z" },
    });
    expect(result.effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: first, by: "call" },
    ]);
    // The others stay in place.
    const { items } = value(await context.call(hand, "list_entry_versions", { id: entry.id }));
    expect(items.map((each) => [each.version, each.words])).toEqual([
      [1, second],
      [0, first],
    ]);
  });

  test("restored words that contain an Inline Task marker make no Task", async () => {
    const context = newContext();
    const withMarker = marked("Lease\n[] Sign it");
    const entry = await recorded(context, withMarker);
    value(
      await context.call(hand, "edit_entry", { id: entry.id, words: marked("Lease"), version: 0 }),
    );

    const result = atOnce(
      await context.call(hand, "restore_entry_version", { id: entry.id, restore: 0, version: 1 }),
    );

    expect(result.record.words).toBe(withMarker);
    expect(result.record.tasks).toEqual([]);
    expect(result.effects.map((each) => each.kind)).toEqual(["entry"]);
  });

  test("is stale against a Version no longer current, and changes nothing", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("First"));
    const now = value(
      await context.call(hand, "edit_entry", { id: entry.id, words: marked("Second"), version: 0 }),
    ).record;

    const result = await context.call(hand, "restore_entry_version", {
      id: entry.id,
      restore: 0,
      version: 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "stale" } });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(now);
  });

  test("restoring words the Entry already has changes nothing", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Same"));
    value(
      await context.call(hand, "edit_entry", { id: entry.id, words: marked("Other"), version: 0 }),
    );
    const back = value(
      await context.call(hand, "edit_entry", { id: entry.id, words: entry.words, version: 1 }),
    ).record;

    const result = value(
      await context.call(hand, "restore_entry_version", { id: entry.id, restore: 0, version: 2 }),
    );

    expect(result).toEqual({ record: back, effects: [], changed: false });
  });

  test("a Version the Entry does not have is not found", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Never changed"));

    const result = await context.call(hand, "restore_entry_version", {
      id: entry.id,
      restore: 0,
      version: 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("a Connection is refused the person's words, and an Entry that is not theirs is restored at once", async () => {
    const context = newContext();
    const theirs = await recorded(context, marked("The person's"));
    value(
      await context.call(hand, "edit_entry", {
        id: theirs.id,
        words: marked("Edited"),
        version: 0,
      }),
    );
    const outside = await recorded(context, marked("Outside"), connection);
    value(
      await context.call(connection, "edit_entry", {
        id: outside.id,
        words: marked("Outside, edited"),
        version: 0,
      }),
    );

    const refused = await context.call(connection, "restore_entry_version", {
      id: theirs.id,
      restore: 0,
      version: 1,
    });
    const restored = await context.call(connection, "restore_entry_version", {
      id: outside.id,
      restore: 0,
      version: 1,
    });

    expect(refused).toMatchObject({ ok: false, error: { code: "held" } });
    expect(value(restored).record).toMatchObject({ words: outside.words, version: 2 });
  });
});

describe("list_entry_versions", () => {
  test("is offered to every caller, newest first, 50 to a page, and a cursor reaches the rest", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Version 0"));
    for (let version = 0; version < 52; version++) {
      value(
        await context.call(hand, "edit_entry", {
          id: entry.id,
          words: marked(`Version ${version + 1}`),
          version,
        }),
      );
    }

    for (const caller of everyCaller) {
      const first = value(await context.call(caller, "list_entry_versions", { id: entry.id }));
      expect(first.items.map((each) => each.version)).toEqual(
        Array.from({ length: 50 }, (_, n) => 51 - n),
      );
      const second = value(
        await context.call(caller, "list_entry_versions", {
          id: entry.id,
          cursor: first.next_cursor,
        }),
      );
      expect(second.items.map((each) => each.version)).toEqual([1, 0]);
      expect(second.next_cursor).toBeNull();
    }
  });

  test("a cursor another Entry's Versions gave is invalid input", async () => {
    const context = newContext();
    const [one, other] = [
      await recorded(context, marked("One")),
      await recorded(context, marked("Other")),
    ];
    for (let version = 0; version <= 50; version++) {
      value(
        await context.call(hand, "edit_entry", {
          id: one.id,
          words: marked(`One, ${version}`),
          version,
        }),
      );
    }
    const { next_cursor } = value(await context.call(hand, "list_entry_versions", { id: one.id }));

    const result = await context.call(hand, "list_entry_versions", {
      id: other.id,
      cursor: next_cursor,
    });

    expect(next_cursor).toEqual(expect.any(String));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("an Entry that is not in this Context is not found", async () => {
    const result = await newContext().call(hand, "list_entry_versions", { id: "no-such-entry" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
