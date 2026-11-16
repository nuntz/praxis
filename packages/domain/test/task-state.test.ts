import { describe, expect, test } from "bun:test";
import { type TaskDates, type TaskEvent, type TaskState, taskState } from "../src/index.ts";

// A Task's derived state and its reason is one of the few places with direct tests (section 13):
// every mix of ends, dates and today is too many for scenarios at the tool seam.

const today = "2026-11-15";
const noDates: TaskDates = { due_date: null, defer_date: null };
const at = Date.parse("2026-11-10T08:00:00.000Z");

const actionable: TaskState = {
  is: "open",
  actionable: true,
  delegated: null,
  deferred: null,
  overdue: null,
};

describe("an open Task's state", () => {
  test("with no dates and nothing happened, it is actionable and nothing else", () => {
    expect(taskState([], noDates, today)).toEqual(actionable);
  });

  test.each([
    ["yesterday", "2026-11-14", today, "2026-11-15"],
    ["a month back", "2026-10-15", today, "2026-10-16"],
    ["the last day of February", "2026-02-28", "2026-03-01", "2026-03-01"],
    ["the day before a leap day", "2028-02-28", "2028-03-05", "2028-02-29"],
    ["the last day of a year", "2025-12-31", today, "2026-01-01"],
  ])("is Overdue from the day after a Due Date of %s", (_, due_date, now, since) => {
    expect(taskState([], { due_date, defer_date: null }, now)).toEqual({
      ...actionable,
      overdue: { since },
    });
  });

  test.each([
    ["today", "2026-11-15"],
    ["tomorrow", "2026-11-16"],
  ])("is not Overdue when due %s", (_, due_date) => {
    expect(taskState([], { due_date, defer_date: null }, today)).toEqual(actionable);
  });

  test("is Deferred until a Defer Date that has not come, and so is not actionable", () => {
    expect(taskState([], { due_date: null, defer_date: "2026-11-16" }, today)).toEqual({
      is: "open",
      actionable: false,
      delegated: null,
      deferred: { until: "2026-11-16" },
      overdue: null,
    });
  });

  test.each([
    ["today", "2026-11-15"],
    ["a day gone", "2026-11-01"],
  ])("is not Deferred once its Defer Date has come: %s", (_, defer_date) => {
    expect(taskState([], { due_date: null, defer_date }, today)).toEqual(actionable);
  });

  test("can be Deferred and Overdue at once, with the day for each", () => {
    const dates = { due_date: "2026-11-10", defer_date: "2026-11-20" };

    expect(taskState([], dates, today)).toEqual({
      is: "open",
      actionable: false,
      delegated: null,
      deferred: { until: "2026-11-20" },
      overdue: { since: "2026-11-11" },
    });
  });

  test("a reopened Task takes its dates up again", () => {
    const events: TaskEvent[] = [
      { what: "finished", at },
      { what: "reopened", at: at + 1 },
    ];

    expect(taskState(events, { due_date: "2026-11-01", defer_date: null }, today)).toEqual({
      ...actionable,
      overdue: { since: "2026-11-02" },
    });
  });
});

describe("a closed Task's state", () => {
  test.each([
    ["finished", "a Due Date gone", { due_date: "2026-11-01", defer_date: null }],
    ["dropped", "a Defer Date to come", { due_date: null, defer_date: "2026-12-01" }],
  ] as const)(
    "is the end it reached, %s, and never Overdue or Deferred, with %s",
    (end, _, dates) => {
      expect(taskState([{ what: end, at }], dates, today)).toEqual({
        is: end,
        at: "2026-11-10T08:00:00.000Z",
      });
    },
  );

  test("is the last end it reached, unless reopened since", () => {
    const events: TaskEvent[] = [
      { what: "finished", at },
      { what: "reopened", at: at + 1 },
      { what: "dropped", at: at + 2 },
    ];

    expect(taskState(events, noDates, today)).toEqual({
      is: "dropped",
      at: "2026-11-10T08:00:00.002Z",
    });
  });
});

describe("a Delegated Task's state", () => {
  const alice = { id: "alice", name: "Alice" };
  const bob = { id: "bob", name: "Bob" };
  const delegated = (to = alice, when = at): TaskEvent => ({ what: "delegated", at: when, to });
  const toAlice = { to: alice, since: "2026-11-10T08:00:00.000Z" };

  test("says who it is Delegated to and since when, and is not actionable", () => {
    expect(taskState([delegated()], noDates, today)).toEqual({
      ...actionable,
      actionable: false,
      delegated: toAlice,
    });
  });

  test("is Delegated to the last Person it was handed to, since then", () => {
    expect(taskState([delegated(), delegated(bob, at + 1)], noDates, today)).toEqual({
      ...actionable,
      actionable: false,
      delegated: { to: bob, since: "2026-11-10T08:00:00.001Z" },
    });
  });

  test("can be Delegated, Deferred and Overdue at once", () => {
    const dates = { due_date: "2026-11-10", defer_date: "2026-11-20" };

    expect(taskState([delegated()], dates, today)).toEqual({
      is: "open",
      actionable: false,
      delegated: toAlice,
      deferred: { until: "2026-11-20" },
      overdue: { since: "2026-11-11" },
    });
  });

  test("is actionable again once taken back", () => {
    const events: TaskEvent[] = [delegated(), { what: "taken_back", at: at + 1 }];

    expect(taskState(events, noDates, today)).toEqual(actionable);
  });

  test.each(["finished", "dropped"] as const)(
    "the delegation ends when the Task is %s, and reopening does not bring it back",
    (end) => {
      const closed: TaskEvent[] = [delegated(), { what: end, at: at + 1 }];

      expect(taskState(closed, noDates, today)).toEqual({
        is: end,
        at: "2026-11-10T08:00:00.001Z",
      });
      expect(taskState([...closed, { what: "reopened", at: at + 2 }], noDates, today)).toEqual(
        actionable,
      );
    },
  );
});
