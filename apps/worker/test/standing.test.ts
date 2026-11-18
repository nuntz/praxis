import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { summarizeWords } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { seeded } from "../../../packages/domain/test/seeded.ts";
import { marked } from "./markers.ts";
import { scriptModel, textOf } from "./model-fake.ts";
import { agent, connection, DAY, hand, newContext, readOnlyConnection, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** An Entry recorded by this caller, as the write returned it. */
async function recorded(context: Context, words: string, caller = hand) {
  return value(await context.call(caller, "record_entry", { words })).record;
}

/** Words that take exactly `size` characters as seen, carrying a marker. */
function wordsOf(size: number, fill = "a") {
  const words = marked("Standing");
  return words + fill.repeat(size - words.length);
}

/** The ids of the Context's Standing Entries, newest first, as list_entries narrows to them. */
async function standingIds(context: Context) {
  const { items } = value(await context.call(hand, "list_entries", { standing: true }));
  return items.map((entry) => entry.id);
}

describe("mark_standing", () => {
  test("makes an Entry a Standing Entry, a change to it, and list_entries narrows to it", async () => {
    const context = newContext();
    const words = marked("Never book meetings before ten");
    const entry = await recorded(context, words);
    await recorded(context, marked("Bought milk"));
    expect(entry.standing).toBe(false);

    const result = value(await context.call(hand, "mark_standing", { id: entry.id }));

    expect(result.record).toEqual({ ...entry, standing: true });
    expect(result.effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: words, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(result.record);
    expect(await standingIds(context)).toEqual([entry.id]);
  });
});

describe("mark_standing: what it marks", () => {
  test("marking a Standing Entry changes nothing", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Write in British English"));
    value(await context.call(hand, "mark_standing", { id: entry.id }));

    const again = value(await context.call(hand, "mark_standing", { id: entry.id }));

    expect(again).toMatchObject({ record: { standing: true }, effects: [], changed: false });
  });

  test("the Agent marks one when asked, an Entry the person wrote among them, and it is not held", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("My partner is called Sam"));

    const result = value(await context.call(agent, "mark_standing", { id: entry.id }));

    expect(result.record).toMatchObject({ standing: true, author: { kind: "person" } });
    expect(await standingIds(context)).toEqual([entry.id]);
  });

  test("a Follow-up to a Standing Entry is not standing unless marked", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("The gym is closed on Mondays"));
    value(await context.call(hand, "mark_standing", { id: entry.id }));

    const followUp = value(
      await context.call(hand, "record_entry", {
        words: marked("It now opens on Mondays too"),
        follow_up_to: entry.id,
      }),
    ).record;

    expect(followUp.standing).toBe(false);
    expect(await standingIds(context)).toEqual([entry.id]);
    value(await context.call(hand, "mark_standing", { id: followUp.id }));
    expect(await standingIds(context)).toEqual([followUp.id, entry.id]);
  });

  test("an Entry not in this Context, or in the Trash, is not found", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Gone"));
    value(await context.call(hand, "delete_entry", { id: entry.id }));

    for (const id of ["no-such-entry", entry.id]) {
      const result = await context.call(hand, "mark_standing", { id });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });
});

describe("unmark_standing", () => {
  test("makes a Standing Entry an ordinary Entry again, which stays in the Journal", async () => {
    const context = newContext();
    const words = marked("Call me Nic");
    const entry = await recorded(context, words);
    value(await context.call(hand, "mark_standing", { id: entry.id }));

    const result = value(await context.call(agent, "unmark_standing", { id: entry.id }));

    expect(result.record).toEqual(entry);
    expect(result.effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: words, by: "call" },
    ]);
    expect(await standingIds(context)).toEqual([]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
  });

  test("unmarking an Entry that is not standing changes nothing", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Just a note"));

    const result = value(await context.call(hand, "unmark_standing", { id: entry.id }));

    expect(result).toMatchObject({ record: entry, effects: [], changed: false });
  });
});

describe("a Standing Entry in the Trash", () => {
  test("is not standing while there, and comes back standing when restored", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Water the plants on Fridays"));
    value(await context.call(hand, "mark_standing", { id: entry.id }));

    value(await context.call(hand, "delete_entry", { id: entry.id }));
    expect(await standingIds(context)).toEqual([]);

    value(await context.call(hand, "restore", { id: entry.id }));
    expect(await standingIds(context)).toEqual([entry.id]);
  });

  test("is removed for good with its mark", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Forget me"));
    value(await context.call(hand, "mark_standing", { id: entry.id }));
    value(await context.call(hand, "delete_entry", { id: entry.id }));

    value(await context.call(hand, "remove_for_good", { id: entry.id }));

    expect(await standingIds(context)).toEqual([]);
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
  });
});

describe("mark_standing: the ceiling", () => {
  test("a mark that would pass 10,000 characters in all is refused with the reason, and one that reaches it is not", async () => {
    const context = newContext();
    const first = await recorded(context, wordsOf(6_000));
    const second = await recorded(context, wordsOf(4_000));
    const third = await recorded(context, wordsOf(100));
    value(await context.call(hand, "mark_standing", { id: first.id }));
    value(await context.call(agent, "mark_standing", { id: second.id }));

    const refused = await context.call(agent, "mark_standing", { id: third.id });

    expect(refused).toEqual({
      ok: false,
      error: {
        code: "refused",
        message: expect.stringContaining("10,000"),
        in_the_way: [
          { kind: "entry", id: second.id, summary: summarizeWords(second.words) },
          { kind: "entry", id: first.id, summary: summarizeWords(first.words) },
        ],
      },
    });
    expect(await standingIds(context)).toEqual([second.id, first.id]);
  });

  test("counts characters as seen, so a letter written with an accent apart is one", async () => {
    const context = newContext();
    // "e" and a combining acute accent: two code units, one character as seen.
    const entry = await recorded(context, wordsOf(10_000, "e\u0301"));

    const result = await context.call(hand, "mark_standing", { id: entry.id });

    expect(result.ok).toBe(true);
  });

  test("a single Entry longer than the ceiling is refused, with nothing else in the way", async () => {
    const context = newContext();
    const entry = await recorded(context, wordsOf(10_001));

    const refused = await context.call(hand, "mark_standing", { id: entry.id });

    expect(refused).toMatchObject({ ok: false, error: { code: "refused", in_the_way: [] } });
  });
});

describe("edit_entry and restore_entry_version on a Standing Entry", () => {
  test("a change to its words that would pass the ceiling is refused, and one within it is made", async () => {
    const context = newContext();
    const other = await recorded(context, wordsOf(9_000));
    const entry = await recorded(context, wordsOf(500));
    for (const { id } of [other, entry]) value(await context.call(hand, "mark_standing", { id }));

    const refused = await context.call(hand, "edit_entry", {
      id: entry.id,
      words: wordsOf(1_001),
      version: 0,
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "entry", id: other.id }] },
    });

    const within = wordsOf(1_000);
    value(await context.call(hand, "edit_entry", { id: entry.id, words: within, version: 0 }));
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toMatchObject({
      words: within,
      standing: true,
    });
  });

  test("putting back longer words that would pass it is refused", async () => {
    const context = newContext();
    const other = await recorded(context, wordsOf(5_000));
    const entry = await recorded(context, wordsOf(5_000));
    value(
      await context.call(hand, "edit_entry", { id: entry.id, words: wordsOf(100), version: 0 }),
    );
    for (const { id } of [other, entry]) value(await context.call(hand, "mark_standing", { id }));
    value(
      await context.call(hand, "edit_entry", { id: other.id, words: wordsOf(9_000), version: 0 }),
    );

    const refused = await context.call(hand, "restore_entry_version", {
      id: entry.id,
      restore: 0,
      version: 1,
    });

    expect(refused).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("words that change an Entry not standing are never held to the ceiling", async () => {
    const context = newContext();
    const other = await recorded(context, wordsOf(10_000));
    value(await context.call(hand, "mark_standing", { id: other.id }));
    const entry = await recorded(context, wordsOf(100));

    const result = await context.call(hand, "edit_entry", {
      id: entry.id,
      words: wordsOf(20_000),
      version: 0,
    });

    expect(result.ok).toBe(true);
  });
});

describe("a Standing Entry in the Trash and the ceiling", () => {
  test("keeps its room, so a mark that would need it is refused, and restoring it is never refused", async () => {
    const context = newContext();
    const entry = await recorded(context, wordsOf(6_000));
    value(await context.call(hand, "mark_standing", { id: entry.id }));
    value(await context.call(hand, "delete_entry", { id: entry.id }));
    const other = await recorded(context, wordsOf(5_000));

    const refused = await context.call(hand, "mark_standing", { id: other.id });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "entry", id: entry.id }] },
    });

    value(await context.call(hand, "restore", { id: entry.id }));
    expect(await standingIds(context)).toEqual([entry.id]);
  });

  test("removed for good, gives its room back", async () => {
    const context = newContext();
    const entry = await recorded(context, wordsOf(6_000));
    value(await context.call(hand, "mark_standing", { id: entry.id }));
    value(await context.call(hand, "delete_entry", { id: entry.id }));
    const other = await recorded(context, wordsOf(5_000));

    value(await context.call(hand, "remove_for_good", { id: entry.id }));

    expect((await context.call(hand, "mark_standing", { id: other.id })).ok).toBe(true);
  });
});

describe("send_message: the Standing Entries the Agent is given", () => {
  test("at the start of a Run, every Standing Entry of the Context with its date, and no other Entry", async () => {
    const seen: string[] = [];
    scriptModel((context) => {
      seen.push(textOf(context.messages.findLast((message) => message.role === "user")));
      return fauxAssistantMessage("Noted.");
    });
    // Late in the evening in Auckland's time zone, the next day there.
    const context = newContext("2026-11-02T20:00:00.000Z", {
      name: "Home",
      time_zone: "Pacific/Auckland",
    });
    const older = await recorded(context, marked("Never schedule anything on Sundays"));
    context.advance(10 * DAY);
    const newer = await recorded(context, marked("Sundays are fine now, mornings only"));
    const ordinary = await recorded(context, marked("Bought a new kettle"));
    const trashed = await recorded(context, marked("I am vegetarian"));
    for (const { id } of [older, newer, trashed]) {
      value(await context.call(hand, "mark_standing", { id }));
    }
    value(await context.call(hand, "delete_entry", { id: trashed.id }));

    await context.callAny(hand, "send_message", { words: "Plan my weekend" });
    await context.runsEnded();

    expect(seen).toHaveLength(1);
    const told = seen[0] as string;
    expect(told).toContain(`day="2026-11-03">\n${older.words}`);
    expect(told).toContain(`day="2026-11-13">\n${newer.words}`);
    expect(told.indexOf(older.words)).toBeLessThan(told.indexOf(newer.words));
    expect(told).not.toContain(ordinary.words);
    expect(told).not.toContain(trashed.words);
  });

  test("each Run, as they stand when its Message is sent", async () => {
    const seen: string[] = [];
    scriptModel((context) => {
      seen.push(textOf(context.messages.findLast((message) => message.role === "user")));
      return fauxAssistantMessage("Noted.");
    });
    const context = newContext();
    const entry = await recorded(context, marked("Reply to email within a day"));
    value(await context.call(hand, "mark_standing", { id: entry.id }));
    await context.callAny(hand, "send_message", { words: "Morning" });
    await context.runsEnded();

    value(await context.call(hand, "unmark_standing", { id: entry.id }));
    await context.callAny(hand, "send_message", { words: "Evening" });
    await context.runsEnded();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain(entry.words);
    expect(seen[1]).not.toContain(entry.words);
  });
});

describe("list_entries narrowed to Standing Entries", () => {
  test("is how a Connection reads them, which cannot mark or unmark one", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Invoices go to the shared inbox"));
    await recorded(context, marked("Lunch with Ana"));
    value(await context.call(hand, "mark_standing", { id: entry.id }));

    for (const caller of [connection, readOnlyConnection]) {
      const { items } = value(await context.call(caller, "list_entries", { standing: true }));
      expect(items).toEqual([{ ...entry, standing: true }]);
    }
    for (const tool of ["mark_standing", "unmark_standing"] as const) {
      const result = await context.call(connection, tool, { id: entry.id });
      expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
    }
  });

  test("pages newest first, 50 to a page, like the whole list", async () => {
    const context = newContext();
    const ids: string[] = [];
    for (let n = 0; n < 52; n++) {
      const entry = await recorded(context, marked(`Rule ${n}`));
      await recorded(context, marked(`Note ${n}`));
      value(await context.call(hand, "mark_standing", { id: entry.id }));
      ids.unshift(entry.id);
    }

    const first = value(await context.call(hand, "list_entries", { standing: true }));
    const cursor = first.next_cursor as string;
    const second = value(await context.call(hand, "list_entries", { standing: true, cursor }));

    expect([...first.items, ...second.items].map((entry) => entry.id)).toEqual(ids);
    expect(second.next_cursor).toBeNull();
  });
});

describe("mark_standing and unmark_standing undone", () => {
  test("over orderings drawn from a seeded source, undoing every step reads back what was there", async () => {
    const draw = seeded(63);
    for (let run = 0; run < 8; run++) {
      const context = newContext();
      const entries = [];
      for (let n = 0; n < 4; n++) entries.push(await recorded(context, wordsOf(2_500 + 300 * n)));
      const read = async () => ({
        standing: await standingIds(context),
        entries: value(await context.call(hand, "list_entries", {})).items,
      });

      // Each step marks or unmarks an Entry drawn at random. All four would pass the ceiling, so
      // some marks are refused, and a refused mark is no step at all.
      const undo: { tool: "mark_standing" | "unmark_standing"; id: string; before: unknown }[] = [];
      for (let step = 0; step < 12; step++) {
        const entry = entries[Math.floor(draw() * entries.length)] as (typeof entries)[number];
        const tool = draw() < 0.6 ? "mark_standing" : "unmark_standing";
        const before = await read();
        const result = await context.call(draw() < 0.5 ? hand : agent, tool, { id: entry.id });
        if (!result.ok) {
          expect(result.error.code).toBe("refused");
          expect(await read()).toEqual(before);
          continue;
        }
        if (!result.value.changed) continue;
        undo.push({
          tool: tool === "mark_standing" ? "unmark_standing" : "mark_standing",
          id: entry.id,
          before,
        });
      }
      for (const { tool, id, before } of undo.toReversed()) {
        value(await context.call(hand, tool, { id }));
        expect(await read()).toEqual(before);
      }
    }
  });
});
