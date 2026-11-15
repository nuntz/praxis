import { describe, expect, test } from "vitest";
import { marked, marker } from "./markers.ts";
import { agent, connection, everyCaller, hand, newContext, value } from "./seam.ts";

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
        caller: { kind: "connection", name: "Claude Code" },
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
    expect(nothingYet).toEqual({ items: [], cursor, more: false });

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

  test("a cursor this list did not give is invalid input", async () => {
    const context = newContext();

    for (const cursor of ["not-a-cursor", btoa("[1,2]"), btoa('["changes",-1]')]) {
      const result = await context.call(hand, "list_changes", { cursor });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });
});
