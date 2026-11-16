import type { Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, everyCaller, hand, newContext, value } from "./seam.ts";

describe("get_settings", () => {
  test("gives the Context's name, its time zone and today's date there, to every caller", async () => {
    // 23:30 in London is already the next morning in Auckland.
    const context = newContext("2026-11-15T23:30:00.000Z", {
      name: "Work",
      time_zone: "Pacific/Auckland",
    });

    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "get_settings", {}))).toEqual({
        name: "Work",
        time_zone: "Pacific/Auckland",
        today: "2026-11-16",
      });
    }
  });

  test("today turns at midnight in the Context's time zone, not the server's", async () => {
    const context = newContext("2026-11-15T07:59:00.000Z", {
      name: "Home",
      time_zone: "America/Los_Angeles",
    });
    const before = value(await context.call(agent, "get_settings", {}));
    context.advance(60_000);

    const after = value(await context.call(agent, "get_settings", {}));

    expect([before.today, after.today]).toEqual(["2026-11-14", "2026-11-15"]);
  });

  test("a Context nobody has made yet is in UTC", async () => {
    const context = newContext("2026-11-15T23:30:00.000Z");

    expect(value(await context.call(hand, "get_settings", {}))).toMatchObject({
      time_zone: "UTC",
      today: "2026-11-15",
    });
  });
});

describe("set_time_zone", () => {
  test("changes the Context's time zone and so its today, an Effect on the Context", async () => {
    const context = newContext("2026-11-15T20:00:00.000Z", {
      name: "Work",
      time_zone: "Pacific/Auckland",
    });

    const result = value(await context.call(hand, "set_time_zone", { time_zone: "Europe/London" }));

    const settings = { name: "Work", time_zone: "Europe/London", today: "2026-11-15" };
    expect(result.record).toEqual(settings);
    expect(result.effects).toEqual([
      { kind: "context", id: expect.any(String), what: "changed", summary: "Work", by: "call" },
    ]);
    expect(value(await context.call(connection, "get_settings", {}))).toEqual(settings);
  });

  test("moves no date: a Task keeps its days, and only what today makes of them shifts", async () => {
    // Nine in the morning of the 16th in Auckland is noon on the 15th in Los Angeles.
    const context = newContext("2026-11-15T20:00:00.000Z", {
      name: "Work",
      time_zone: "Pacific/Auckland",
    });
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Lease"),
        tasks: [{ title: marked("Send the lease") }],
      }),
    );
    const task = entry.tasks[0] as Task;
    const dates = { due_date: "2026-11-15", defer_date: "2026-11-16" };
    value(await context.call(hand, "set_task_dates", { id: task.id, ...dates }));
    const inAuckland = value(await context.call(hand, "get_task", { id: task.id }));

    value(await context.call(hand, "set_time_zone", { time_zone: "America/Los_Angeles" }));

    const inLosAngeles = value(await context.call(hand, "get_task", { id: task.id }));
    expect(inAuckland).toMatchObject({
      ...dates,
      state: { actionable: true, deferred: null, overdue: { since: "2026-11-16" } },
    });
    expect(inLosAngeles).toMatchObject({
      ...dates,
      state: { actionable: false, deferred: { until: "2026-11-16" }, overdue: null },
    });
  });

  test("the time zone the Context has already changes nothing, however it is written", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z", {
      name: "Work",
      time_zone: "Europe/Paris",
    });

    for (const time_zone of ["Europe/Paris", "europe/paris"]) {
      const result = value(await context.call(hand, "set_time_zone", { time_zone }));
      expect(result).toEqual({
        record: { name: "Work", time_zone: "Europe/Paris", today: "2026-11-15" },
        effects: [],
        changed: false,
      });
    }
  });

  test("a time zone is one of the IANA database, never an offset or a word", async () => {
    const context = newContext();

    for (const time_zone of ["+13:00", "-05:00", "Nowhere/Land", "local", "", 13]) {
      const result = await context.call(hand, "set_time_zone", { time_zone });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "get_settings", {})).time_zone).toBe("UTC");
  });
});
