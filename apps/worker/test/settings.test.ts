import { FIRST_TIMES, type Task } from "@praxis/domain";
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
      expect(value(await context.call(caller, "get_settings", {}))).toMatchObject({
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
});

describe("the Brief and the Review times", () => {
  test("a new Context starts with the Brief on at 07:00 and the Review on Sunday at 17:00", async () => {
    const context = newContext();

    expect(value(await context.call(hand, "get_settings", {}))).toMatchObject({
      brief_time: "07:00",
      review_day: "sunday",
      review_time: "17:00",
    });
  });
});

describe("set_brief_time", () => {
  test("sets the Brief's time or switches it off, an Effect on the Context", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z", { name: "Work", time_zone: "UTC" });

    const later = value(await context.call(agent, "set_brief_time", { time: "08:30" }));
    const off = value(await context.call(hand, "set_brief_time", { time: null }));

    expect(later.record).toMatchObject({ brief_time: "08:30" });
    expect(off.record).toMatchObject({ brief_time: null });
    for (const { effects } of [later, off]) {
      expect(effects).toEqual([
        { kind: "context", id: expect.any(String), what: "changed", summary: "Work", by: "call" },
      ]);
    }
    expect(value(await context.call(connection, "get_settings", {}))).toMatchObject({
      brief_time: null,
      review_time: "17:00",
    });
  });

  test("the time it has already changes nothing", async () => {
    const context = newContext();

    const result = value(await context.call(hand, "set_brief_time", { time: "07:00" }));

    expect(result).toMatchObject({ effects: [], changed: false });
  });

  test("a time is HH:MM on the 24-hour clock", async () => {
    const context = newContext();

    for (const time of ["7:00", "24:00", "07:60", "7am", "", 7]) {
      const result = await context.call(hand, "set_brief_time", { time });
      expect(result.ok ? null : result.error.code).toBe("invalid_input");
    }
  });
});

describe("set_review_time", () => {
  test("sets the Review's day and time, or switches it off and keeps its day", async () => {
    const context = newContext();

    const friday = value(
      await context.call(agent, "set_review_time", { day: "friday", time: "16:00" }),
    );
    const off = value(await context.call(hand, "set_review_time", { time: null }));
    const on = value(await context.call(hand, "set_review_time", { time: "09:00" }));

    expect(friday.record).toMatchObject({ review_day: "friday", review_time: "16:00" });
    expect(friday.effects).toHaveLength(1);
    expect(off.record).toMatchObject({ review_day: "friday", review_time: null });
    expect(on.record).toMatchObject({ review_day: "friday", review_time: "09:00" });
    expect(value(await context.call(hand, "get_settings", {}))).toMatchObject({
      brief_time: "07:00",
      review_day: "friday",
      review_time: "09:00",
    });
  });

  test("a day is a day of the week", async () => {
    const context = newContext();

    for (const day of ["Friday", "fri", "", 5]) {
      const result = await context.call(hand, "set_review_time", { day, time: "16:00" });
      expect(result.ok ? null : result.error.code).toBe("invalid_input");
    }
  });
});

describe("set_time_zone", () => {
  test("changes the Context's time zone and so its today, an Effect on the Context", async () => {
    const context = newContext("2026-11-15T20:00:00.000Z", {
      name: "Work",
      time_zone: "Pacific/Auckland",
    });

    const result = value(await context.call(hand, "set_time_zone", { time_zone: "Europe/London" }));

    const settings = {
      name: "Work",
      time_zone: "Europe/London",
      today: "2026-11-15",
      ...FIRST_TIMES,
      notifications: true,
    };
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
        record: {
          name: "Work",
          time_zone: "Europe/Paris",
          today: "2026-11-15",
          ...FIRST_TIMES,
          notifications: true,
        },
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

describe("set_notifications", () => {
  test("a new Context's switch is on: whether a Device is sent its Notifications is the Device's", async () => {
    const context = newContext();

    expect(value(await context.call(connection, "get_settings", {}))).toMatchObject({
      notifications: true,
    });
  });

  test("turns the Context's one switch, covering the Brief and the Review, an Effect on the Context", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z", { name: "Work", time_zone: "UTC" });

    const off = value(await context.call(hand, "set_notifications", { on: false }));
    const again = value(await context.call(hand, "set_notifications", { on: false }));
    const on = value(await context.call(hand, "set_notifications", { on: true }));

    expect(off.record).toMatchObject({ notifications: false });
    expect(off.effects).toEqual([
      { kind: "context", id: expect.any(String), what: "changed", summary: "Work", by: "call" },
    ]);
    expect(again).toMatchObject({ effects: [], changed: false });
    expect(on.record).toMatchObject({ notifications: true });
    expect(value(await context.call(agent, "get_settings", {}))).toMatchObject({
      notifications: true,
      brief_time: "07:00",
      review_time: "17:00",
    });
  });

  test("is said on or off", async () => {
    const context = newContext();

    for (const input of [{}, { on: "yes" }]) {
      expect(await context.call(hand, "set_notifications", input)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
  });
});
