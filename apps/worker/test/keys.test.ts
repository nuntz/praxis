import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, hand, newContext, value } from "./seam.ts";

// Every write accepts an optional key (section 4.5). The oracle holds a repeat to changing
// nothing and adding nothing to the change log; these tests say what it returns.

async function entryCount(context: ReturnType<typeof newContext>) {
  return value(await context.call(hand, "list_entries", {})).items.length;
}

describe("a write's key", () => {
  test("a repeat returns the first result and records nothing again", async () => {
    const context = newContext();
    const input = { words: marked("Sent twice by a flaky network"), key: "unsent-1" };

    const first = await context.call(hand, "record_entry", input);
    context.advance(5_000);
    const repeat = await context.call(hand, "record_entry", input);

    expect(repeat).toEqual(first);
    expect(await entryCount(context)).toBe(1);
    expect(value(await context.call(hand, "list_changes", {})).items).toHaveLength(1);
  });

  test("is the caller's own: another caller's same key is another write", async () => {
    const context = newContext();

    for (const caller of [
      hand,
      agent,
      connection,
      { kind: "connection", id: "another-connection", name: "Other" } as const,
    ]) {
      value(await context.call(caller, "record_entry", { words: marked("Same key"), key: "k" }));
    }

    expect(await entryCount(context)).toBe(4);
  });

  test("a Connection is told apart by its id: two sharing a name have keys of their own", async () => {
    const context = newContext();
    const twin = { ...connection, id: "its-twin" };

    const first = value(await context.call(connection, "record_entry", { words: "A", key: "k" }));
    const other = value(await context.call(twin, "record_entry", { words: "B", key: "k" }));

    expect(other.record.id).not.toBe(first.record.id);
    expect(await entryCount(context)).toBe(2);
  });

  test("a Connection renamed keeps its keys", async () => {
    const context = newContext();
    const input = { words: marked("Sent before the rename"), key: "k" };

    const first = await context.call(connection, "record_entry", input);
    const repeat = await context.call({ ...connection, name: "Renamed" }, "record_entry", input);

    expect(repeat).toEqual(first);
    expect(await entryCount(context)).toBe(1);
  });

  test("input that is not valid is not remembered, so a corrected call with the key runs", async () => {
    const context = newContext();

    const invalid = await context.call(hand, "record_entry", { words: " ", key: "k" });
    const valid = await context.call(hand, "record_entry", { words: marked("Fixed"), key: "k" });

    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(valid).toMatchObject({ ok: true });
    expect(await entryCount(context)).toBe(1);
  });

  test("a key must be a string with something in it", async () => {
    const context = newContext();

    for (const key of ["", 7, null]) {
      const result = await context.call(hand, "record_entry", { words: marked("Keyed"), key });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });

  test("is remembered for 30 days", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const input = { words: marked("Sent from a Device away for weeks"), key: "unsent-2" };
    const first = await context.call(hand, "record_entry", input);

    context.advance(30 * DAY - 1);
    await context.fireAlarm();
    expect(await context.call(hand, "record_entry", input)).toEqual(first);
    expect(await entryCount(context)).toBe(1);
  });

  test("is forgotten once 30 days have passed, before the alarm gets to it", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const input = { words: marked("Sent again after a month"), key: "unsent-4" };
    const first = value(await context.call(hand, "record_entry", input));

    context.advance(30 * DAY);
    const again = value(await context.call(hand, "record_entry", input));
    context.advance(DAY);
    const third = await context.call(hand, "record_entry", input);

    expect(again.record.id).not.toBe(first.record.id);
    expect(third).toEqual({ ok: true, value: again });
    expect(await entryCount(context)).toBe(2);
  });

  test("a keyed write schedules the alarm, which the platform runs by the real clock", async () => {
    const context = newContext("2020-01-01T00:00:00.000Z");
    const input = { words: marked("Long ago"), key: "old" };
    expect(await context.runScheduledAlarm()).toBe(false);

    const first = value(await context.call(hand, "record_entry", input));
    expect(await context.runScheduledAlarm()).toBe(true);

    const again = value(await context.call(hand, "record_entry", input));
    expect(again.record.id).not.toBe(first.record.id);
  });
});
