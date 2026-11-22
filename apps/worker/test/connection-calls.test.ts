import { describe, expect, test } from "vitest";
import { marked, markersIn } from "./markers.ts";
import { noModel } from "./model-fake.ts";
import { agent, connection, DAY, hand, newContext, readOnlyConnection, value } from "./seam.ts";

// The record of a Connection's calls (sections 7.3 and 10.5): every call from a Connection, reads
// included, kept 90 days, with the tool, the time, the result code and how many records came back,
// and never the text of what it sent or was given. Only the person's hand reads it.

describe("list_connection_calls", () => {
  test("lists each call from a Connection newest first, reads included, with its tool, time, result and count", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    value(await context.call(hand, "record_entry", { words: marked("Mine") }));
    value(await context.call(hand, "record_entry", { words: marked("Also mine") }));
    context.advance(60_000);
    value(await context.call(connection, "list_entries", {}));
    context.advance(60_000);
    value(await context.call(connection, "record_entry", { words: marked("Theirs") }));
    context.advance(60_000);
    await context.call(connection, "get_entry", { id: "no-such-entry" });

    const { items, next_cursor } = value(await context.call(hand, "list_connection_calls", {}));

    expect(items).toEqual([
      {
        at: "2026-11-15T09:03:00.000Z",
        caller: { kind: "connection", id: "claude-code", name: "Claude Code" },
        tool: "get_entry",
        kind: "read",
        result: "not_found",
        records: 0,
      },
      {
        at: "2026-11-15T09:02:00.000Z",
        caller: { kind: "connection", id: "claude-code", name: "Claude Code" },
        tool: "record_entry",
        kind: "write",
        result: "ok",
        records: 1,
      },
      {
        at: "2026-11-15T09:01:00.000Z",
        caller: { kind: "connection", id: "claude-code", name: "Claude Code" },
        tool: "list_entries",
        kind: "read",
        result: "ok",
        records: 2,
      },
    ]);
    expect(next_cursor).toBeNull();
  });

  test("keeps a call it refused, by its code, and a name that is no tool as none", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    await context.call(readOnlyConnection, "record_entry", { words: marked("Never made") });
    await context.callAny(connection, "drop_every_table", {});
    await context.call(connection, "list_runs", {});
    await context.callAny(connection, "send_message", { words: marked("Hello"), spoken: false });

    const { items } = value(await context.call(hand, "list_connection_calls", {}));

    expect(
      items.map(({ caller, tool, kind, result, records }) => ({
        caller: caller.kind,
        tool,
        kind,
        result,
        records,
      })),
    ).toEqual([
      // A Conversation tool is a tool of Praxis's, kept by its name, though never offered.
      {
        caller: "connection",
        tool: "send_message",
        kind: "write",
        result: "not_offered",
        records: 0,
      },
      { caller: "connection", tool: "list_runs", kind: "read", result: "not_offered", records: 0 },
      { caller: "connection", tool: null, kind: null, result: "not_offered", records: 0 },
      {
        caller: "read_only_connection",
        tool: "record_entry",
        kind: "write",
        result: "not_offered",
        records: 0,
      },
    ]);
  });

  test("keeps none of what a Connection sent or was given", async () => {
    const context = newContext();
    const words = marked("Theirs to find");
    value(await context.call(connection, "record_entry", { words }));
    value(await context.call(connection, "search", { words }));
    value(await context.call(connection, "list_entries", {}));

    const read = await context.call(hand, "list_connection_calls", {});

    expect(markersIn(JSON.stringify(read))).toEqual([]);
    expect(value(read).items.map(({ tool, records }) => ({ tool, records }))).toEqual([
      { tool: "list_entries", records: 1 },
      { tool: "search", records: 1 },
      { tool: "record_entry", records: 1 },
    ]);
  });

  test("keeps no call from the hand or the Agent", async () => {
    const context = newContext();
    value(await context.call(hand, "list_entries", {}));
    value(await context.call(agent, "record_entry", { words: marked("The Agent's") }));

    expect(value(await context.call(hand, "list_connection_calls", {})).items).toEqual([]);
  });

  test("keeps each call 90 days, pruned by the Context's alarm", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    value(await context.call(connection, "list_entries", {}));
    context.advance(DAY);
    value(await context.call(connection, "list_tasks", {}));

    // 89 days after the first call, then 90.
    context.advance(88 * DAY);
    await context.fireAlarm();
    const kept = value(await context.call(hand, "list_connection_calls", {})).items;
    context.advance(DAY);
    await context.fireAlarm();
    const later = value(await context.call(hand, "list_connection_calls", {})).items;

    expect(kept.map(({ tool }) => tool)).toEqual(["list_tasks", "list_entries"]);
    expect(later.map(({ tool }) => tool)).toEqual(["list_tasks"]);
  });

  test("a Connection's read, with nothing written and no Brief or Review to wake for, sets the alarm that prunes the record", async () => {
    // Without the Agent's key no clock arms the alarm, so only the record of calls can.
    noModel();
    const context = newContext();
    value(await context.call(connection, "list_entries", {}));

    expect(await context.runScheduledAlarm()).toBe(true);
  });

  test("pages 50 at a time, newest first, from the cursor it gave", async () => {
    const context = newContext();
    for (let call = 0; call < 51; call += 1) {
      value(await context.call(connection, "get_settings", {}));
      context.advance(1000);
    }

    const first = value(await context.call(hand, "list_connection_calls", {}));
    const second = value(
      await context.call(hand, "list_connection_calls", { cursor: first.next_cursor }),
    );

    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.at).toBe("2026-11-15T09:00:00.000Z");
    expect(second.next_cursor).toBeNull();
    expect((await context.call(hand, "list_connection_calls", { cursor: "not-a-cursor" })).ok).toBe(
      false,
    );
  });

  test("narrows to one Connection by its id, and to its reads", async () => {
    const context = newContext();
    const other = { kind: "connection", id: "chatgpt", name: "ChatGPT" } as const;
    value(await context.call(connection, "list_entries", {}));
    value(await context.call(other, "list_tasks", {}));
    value(await context.call(connection, "record_entry", { words: marked("Theirs") }));
    value(await context.call({ ...readOnlyConnection, id: "claude-code" }, "get_settings", {}));

    const theirs = value(
      await context.call(hand, "list_connection_calls", { connection_id: "claude-code" }),
    );
    const theirReads = value(
      await context.call(hand, "list_connection_calls", {
        connection_id: "claude-code",
        reads_only: true,
      }),
    );
    const everyRead = value(
      await context.call(hand, "list_connection_calls", { reads_only: true }),
    );

    expect(theirs.items.map(({ tool }) => tool)).toEqual([
      "get_settings",
      "record_entry",
      "list_entries",
    ]);
    expect(theirReads.items.map(({ tool }) => tool)).toEqual(["get_settings", "list_entries"]);
    expect(everyRead.items.map(({ tool }) => tool)).toEqual([
      "get_settings",
      "list_tasks",
      "list_entries",
    ]);
  });

  test("counts each record a view gives back once, and no future Occurrence, which is no record", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    // A Project due today: in Attention's Due and in its Projects, one record.
    value(
      await context.call(hand, "create_project", { name: marked("Lease"), due_date: "2026-11-15" }),
    );
    // A Task Deferred to the 18th and due on the 20th, so the weeks ahead list it on both days,
    // weekly, so they also list its future Occurrences.
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Plants"),
        tasks: [{ title: marked("Water the plants") }],
      }),
    );
    const task = entry.tasks[0]?.id ?? "";
    value(
      await context.call(hand, "set_task_dates", {
        id: task,
        defer_date: "2026-11-18",
        due_date: "2026-11-20",
      }),
    );
    value(
      await context.call(hand, "set_recurrence", {
        id: task,
        recurrence: { kind: "weeks", every: 1, on: ["friday"] },
      }),
    );
    const attention = value(await context.call(connection, "view_attention", {}));
    const ahead = value(await context.call(connection, "view_ahead", {}));

    const { items } = value(await context.call(hand, "list_connection_calls", {}));

    expect(attention.due).toHaveLength(1);
    expect(attention.projects).toHaveLength(1);
    expect(ahead.items.length).toBeGreaterThan(2);
    expect(items.map(({ tool, records }) => ({ tool, records }))).toEqual([
      { tool: "view_ahead", records: 1 },
      { tool: "view_attention", records: 1 },
    ]);
  });
});
