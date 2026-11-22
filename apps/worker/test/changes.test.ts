import { describe, expect, test } from "vitest";
import { marked, marker } from "./markers.ts";
import { agent, connection, DAY, everyCaller, hand, newContext, value } from "./seam.ts";

describe("record_entry's Effects", () => {
  test("name the Entry it made, by the call, with its first line as the summary", async () => {
    const context = newContext();
    const seeded = marker();
    const words = `\n  Called Ali   about the lease ${seeded}\nStill no answer`;

    const result = value(await context.call(hand, "record_entry", { words }));

    expect(result.changed).toBe(true);
    expect(result.effects).toEqual([
      {
        kind: "entry",
        id: result.record.id,
        what: "made",
        summary: `Called Ali about the lease ${seeded}`,
        by: "call",
      },
    ]);
  });

  test("a summary is the first line with words, whatever ends the lines", async () => {
    const context = newContext();
    const seeded = marker();

    for (const words of [
      `\r\n \t\r\n${seeded}\tafter blank lines\r\nsecond`,
      `${seeded}\tafter blank lines\rold Mac line end`,
    ]) {
      const { effects } = value(await context.call(hand, "record_entry", { words }));
      expect(effects[0]?.summary).toBe(`${seeded} after blank lines`);
    }
  });

  test("a summary is cut to 80 characters as seen, never splitting one", async () => {
    const context = newContext();
    const family = "👩‍👩‍👧";
    const fits = `${marker()} ${"x".repeat(80 - 44)}`;

    const long = value(
      await context.call(hand, "record_entry", { words: `${marker()} ${family.repeat(80)}` }),
    );
    const exact = value(await context.call(hand, "record_entry", { words: fits }));

    const summary = long.effects[0]?.summary ?? "";
    expect(Array.from(new Intl.Segmenter().segment(summary))).toHaveLength(80);
    expect(summary.endsWith(`${family}…`)).toBe(true);
    expect(exact.effects[0]?.summary).toBe(fits);
  });
});

describe("list_changes", () => {
  test("lists each write's Effects oldest first, with its caller and when it arrived", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const byHand = value(await context.call(hand, "record_entry", { words: marked("Mine") }));
    context.advance(90_000);
    const byConnection = value(
      await context.call(connection, "record_entry", { words: marked("Theirs") }),
    );

    const { items, more } = value(await context.call(agent, "list_changes", {}));

    expect(items).toEqual([
      {
        at: "2026-11-15T09:00:00.000Z",
        caller: { kind: "hand" },
        tool: "record_entry",
        effects: byHand.effects,
      },
      {
        at: "2026-11-15T09:01:30.000Z",
        caller: { kind: "connection", id: "claude-code", name: "Claude Code" },
        tool: "record_entry",
        effects: byConnection.effects,
      },
    ]);
    expect(more).toBe(false);
  });

  test("leaves out reads and calls that failed", async () => {
    const context = newContext();
    const { record } = value(await context.call(hand, "record_entry", { words: marked("Once") }));
    await context.call(hand, "get_entry", { id: record.id });
    await context.call(hand, "record_entry", { words: "" });
    await context.callAny(hand, "create_task", { title: marked("No bare Tasks") });

    const { items } = value(await context.call(hand, "list_changes", {}));

    expect(items.map((change) => change.effects[0]?.id)).toEqual([record.id]);
  });

  test("gives 50 writes to a page, and its cursor reaches the rest", async () => {
    const context = newContext();
    const ids: string[] = [];
    for (let n = 1; n <= 53; n++) {
      ids.push(
        value(await context.call(hand, "record_entry", { words: marked(`${n}`) })).record.id,
      );
    }

    const first = value(await context.call(hand, "list_changes", {}));
    expect(first.items.map((change) => change.effects[0]?.id)).toEqual(ids.slice(0, 50));
    expect(first.more).toBe(true);

    const second = value(await context.call(hand, "list_changes", { cursor: first.cursor }));
    expect(second.items.map((change) => change.effects[0]?.id)).toEqual(ids.slice(50));
    expect(second.more).toBe(false);
  });

  test("a cursor from the end reads what changed since, once there is something", async () => {
    const context = newContext();
    value(await context.call(hand, "record_entry", { words: marked("Before") }));
    const { cursor } = value(await context.call(connection, "list_changes", {}));

    const nothingYet = value(await context.call(connection, "list_changes", { cursor }));
    expect(nothingYet).toEqual({ items: [], cursor, more: false, read_afresh: false });

    const later = value(await context.call(agent, "record_entry", { words: marked("Later") }));
    const since = value(await context.call(connection, "list_changes", { cursor }));
    expect(since.items).toEqual([expect.objectContaining({ effects: later.effects })]);
    expect(since.cursor).not.toBe(cursor);
  });

  test("an empty change log is an empty page", async () => {
    const { items, more } = value(await newContext().call(hand, "list_changes", {}));

    expect(items).toEqual([]);
    expect(more).toBe(false);
  });

  test("is offered to every caller", async () => {
    const context = newContext();
    value(await context.call(hand, "record_entry", { words: marked("Seen by all") }));

    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "list_changes", {})).items).toHaveLength(1);
    }
  });

  test("the alarm drops each change once it is 90 days old, and the list starts after them", async () => {
    const context = newContext("2026-01-01T09:00:00.000Z");
    value(await context.call(hand, "record_entry", { words: marked("Old") }));
    context.advance(10 * DAY);
    const newer = value(await context.call(hand, "record_entry", { words: marked("Newer") }));

    context.advance(90 * DAY - 10 * DAY - 1);
    await context.fireAlarm();
    expect(value(await context.call(hand, "list_changes", {})).items).toHaveLength(2);

    context.advance(1);
    await context.fireAlarm();
    const kept = value(await context.call(hand, "list_changes", {}));
    expect(kept.items.map((change) => change.effects)).toEqual([newer.effects]);
    expect(kept.read_afresh).toBe(false);
  });

  test("a cursor older than what is kept is told to read afresh, with a cursor to carry on from", async () => {
    const context = newContext("2026-01-01T09:00:00.000Z");
    const { cursor: fromTheStart } = value(await context.call(hand, "list_changes", {}));
    value(await context.call(hand, "record_entry", { words: marked("Pruned") }));
    context.advance(91 * DAY);
    await context.fireAlarm();
    value(await context.call(hand, "record_entry", { words: marked("Kept") }));

    const told = value(await context.call(hand, "list_changes", { cursor: fromTheStart }));
    expect(told).toEqual({ items: [], cursor: expect.any(String), more: false, read_afresh: true });

    const later = value(await context.call(agent, "record_entry", { words: marked("Later") }));
    const since = value(await context.call(hand, "list_changes", { cursor: told.cursor }));
    expect(since.items.map((change) => change.effects)).toEqual([later.effects]);
    expect(since.read_afresh).toBe(false);
  });

  test("a cursor that had read past every change pruned carries on", async () => {
    const context = newContext("2026-01-01T09:00:00.000Z");
    value(await context.call(hand, "record_entry", { words: marked("Pruned") }));
    const { cursor } = value(await context.call(hand, "list_changes", {}));
    context.advance(91 * DAY);
    await context.fireAlarm();
    const kept = value(await context.call(hand, "record_entry", { words: marked("Kept") }));

    const since = value(await context.call(hand, "list_changes", { cursor }));

    expect(since.items.map((change) => change.effects)).toEqual([kept.effects]);
    expect(since.read_afresh).toBe(false);
  });

  test("a write with no key sets the alarm that prunes the log", async () => {
    const context = newContext();
    value(await context.call(hand, "record_entry", { words: marked("No key") }));

    expect(await context.runScheduledAlarm()).toBe(true);
  });

  test("a cursor this list did not give is invalid input", async () => {
    const context = newContext();

    for (const cursor of ["not-a-cursor", btoa("[1,2]"), btoa('["changes",-1]')]) {
      const result = await context.call(hand, "list_changes", { cursor });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });
});

describe("list_changes narrowed by caller", () => {
  test("gives only the changes that caller made, a Connection by its id whatever its name", async () => {
    const context = newContext();
    const theirs = { ...connection, name: "Claude Code, renamed" };
    const other = { kind: "connection", id: "chatgpt", name: "ChatGPT" } as const;
    value(await context.call(hand, "record_entry", { words: marked("Mine") }));
    const first = value(await context.call(connection, "record_entry", { words: marked("One") }));
    value(await context.call(other, "record_entry", { words: marked("Elsewhere") }));
    value(await context.call(agent, "record_entry", { words: marked("The Agent's") }));
    const second = value(await context.call(theirs, "record_entry", { words: marked("Two") }));

    const byConnection = value(
      await context.call(hand, "list_changes", {
        caller: { kind: "connection", id: "claude-code" },
      }),
    );
    const byHand = value(await context.call(hand, "list_changes", { caller: { kind: "hand" } }));
    const byClock = value(await context.call(hand, "list_changes", { caller: { kind: "clock" } }));

    expect(byConnection.items.map((change) => change.effects)).toEqual([
      first.effects,
      second.effects,
    ]);
    expect(byHand.items.map((change) => change.caller)).toEqual([{ kind: "hand" }]);
    expect(byClock.items).toEqual([]);
    // Whatever it was narrowed by, the cursor stands where the log was read to.
    const { cursor } = value(await context.call(hand, "list_changes", {}));
    expect(byClock.cursor).toBe(cursor);
    expect(byConnection.cursor).toBe(cursor);
  });
});

describe("list_changes newest first", () => {
  test("gives the newest 50 first, and its cursor the earlier ones, narrowed or not", async () => {
    const context = newContext();
    const ids: string[] = [];
    for (let n = 1; n <= 53; n++) {
      const caller = n % 2 === 0 ? connection : hand;
      ids.push(
        value(await context.call(caller, "record_entry", { words: marked(`${n}`) })).record.id,
      );
    }
    const newest = ids.toReversed();

    const first = value(await context.call(hand, "list_changes", { newest_first: true }));
    const second = value(
      await context.call(hand, "list_changes", { newest_first: true, cursor: first.cursor }),
    );
    const byHand = value(
      await context.call(hand, "list_changes", { newest_first: true, caller: { kind: "hand" } }),
    );

    expect(first.items.map((change) => change.effects[0]?.id)).toEqual(newest.slice(0, 50));
    expect(first.more).toBe(true);
    expect(second.items.map((change) => change.effects[0]?.id)).toEqual(newest.slice(50));
    expect(second.more).toBe(false);
    expect(byHand.items.map((change) => change.effects[0]?.id)).toEqual(
      newest.filter((_, place) => place % 2 === 0),
    );
    expect(byHand.more).toBe(false);
  });

  test("a cursor of the oldest-first list is not one it gave, nor the other way about", async () => {
    const context = newContext();
    value(await context.call(hand, "record_entry", { words: marked("One") }));
    const oldest = value(await context.call(hand, "list_changes", {}));
    const newest = value(await context.call(hand, "list_changes", { newest_first: true }));

    expect(
      await context.call(hand, "list_changes", { newest_first: true, cursor: oldest.cursor }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await context.call(hand, "list_changes", { cursor: newest.cursor })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  test("gives nothing pruned, and no page from the end of what is kept", async () => {
    const context = newContext();
    value(await context.call(hand, "record_entry", { words: marked("Old") }));
    context.advance(90 * DAY);
    const kept = value(await context.call(hand, "record_entry", { words: marked("New") }));
    await context.fireAlarm();

    const page = value(await context.call(hand, "list_changes", { newest_first: true }));

    expect(page.items.map((change) => change.effects)).toEqual([kept.effects]);
    expect(page).toMatchObject({ more: false, read_afresh: false });
  });
});
