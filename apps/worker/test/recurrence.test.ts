import type { Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, hand, newContext, readOnlyConnection, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** A Task due on a day, as the person would make one: on an Entry, then dated. */
async function aTaskDue(context: Context, due_date: string, title = marked("Water the plants")) {
  const { record: entry } = value(
    await context.call(hand, "record_entry", { words: marked("Plants"), tasks: [{ title }] }),
  );
  const task = entry.tasks[0] as Task;
  return value(await context.call(hand, "set_task_dates", { id: task.id, due_date })).record;
}

/** Every Occurrence of a recurring Task, oldest first: they all share its Origin Entry. */
async function occurrences(context: Context, task: Task): Promise<Task[]> {
  return value(await context.call(hand, "get_entry", { id: task.origin_entry })).tasks;
}

const weekly = { kind: "weeks", every: 1, on: ["monday"] } as const;

const changedByCall = (task: Task) => ({
  kind: "task",
  id: task.id,
  what: "changed",
  summary: task.title,
  by: "call",
});

describe("set_recurrence", () => {
  test("puts a rule on a Task, read with the Due Date its schedule counts from", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");

    const result = value(
      await context.call(connection, "set_recurrence", { id: task.id, recurrence: weekly }),
    );

    const recurring = { ...task, recurrence: { ...weekly, from: "2026-11-16" } };
    expect(result.record).toEqual(recurring);
    expect(result.effects).toEqual([changedByCall(task)]);
    expect(value(await context.call(readOnlyConnection, "get_task", { id: task.id }))).toEqual(
      recurring,
    );
  });
});

describe("finish_task on a recurring Task", () => {
  test("makes the next Occurrence by rule, due on the next day on the schedule", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));

    const result = value(await context.call(agent, "finish_task", { id: task.id }));

    const entry = value(await context.call(hand, "get_entry", { id: task.origin_entry }));
    const next = entry.tasks[1] as Task;
    expect(result.record).toEqual({
      ...task,
      recurrence: null,
      state: { is: "finished", at: "2026-11-16T09:00:00.000Z" },
    });
    expect(next).toEqual({
      ...task,
      id: expect.any(String),
      at: "2026-11-16T09:00:00.000Z",
      due_date: "2026-11-23",
      recurrence: { ...weekly, from: "2026-11-16" },
    });
    expect(next.id).not.toBe(task.id);
    expect(result.effects).toEqual([
      changedByCall(task),
      { kind: "task", id: next.id, what: "made", summary: task.title, by: "rule" },
    ]);
  });
});

describe("the next Occurrence", () => {
  test("carries the Project, the delegation and the gap from Defer Date to Due Date; waits and References stay behind", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    const { record: plants } = value(
      await context.call(hand, "create_project", { name: marked("Plants") }),
    );
    const { record: alice } = value(
      await context.call(hand, "create_person", { name: marked("Alice") }),
    );
    const { record: other } = value(
      await context.call(hand, "record_entry", {
        words: marked("Soil"),
        tasks: [{ title: marked("Buy soil") }],
      }),
    );
    const soil = other.tasks[0] as Task;
    value(await context.call(hand, "set_task_dates", { id: task.id, defer_date: "2026-11-13" }));
    value(await context.call(hand, "move_task", { id: task.id, project_id: plants.id }));
    value(await context.call(hand, "delegate_task", { id: task.id, person_id: alice.id }));
    value(await context.call(hand, "wait_on", { id: task.id, on: { kind: "task", id: soil.id } }));
    value(
      await context.call(hand, "add_link", {
        entry_id: other.id,
        to: { kind: "task", id: task.id },
      }),
    );
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));
    context.advance(DAY);

    const result = value(await context.call(hand, "finish_task", { id: task.id }));

    const next = value(await context.call(hand, "get_project", { id: plants.id })).tasks[1] as Task;
    expect(next).toEqual({
      ...task,
      id: next.id,
      at: "2026-11-17T09:00:00.000Z",
      project: plants.id,
      due_date: "2026-11-23",
      defer_date: "2026-11-20",
      recurrence: { ...weekly, from: "2026-11-16" },
      state: {
        is: "open",
        actionable: false,
        waiting: null,
        delegated: { to: { id: alice.id, name: alice.name }, since: "2026-11-17T09:00:00.000Z" },
        deferred: { until: "2026-11-20" },
        overdue: null,
      },
    });
    expect(result.effects).toEqual([
      changedByCall(task),
      { kind: "task", id: next.id, what: "made", summary: task.title, by: "rule" },
    ]);
    const links = value(await context.call(hand, "get_entry", { id: other.id })).links;
    expect(links.map((link) => link.to.id)).toEqual([task.id]);
  });

  test("is made when the current one is Dropped, too", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));

    const result = value(await context.call(connection, "drop_task", { id: task.id }));

    const next = await occurrences(context, task);
    expect(next.map((each) => [each.due_date, each.state.is])).toEqual([
      ["2026-11-16", "dropped"],
      ["2026-11-23", "open"],
    ]);
    expect(result.effects).toEqual([
      changedByCall(task),
      { kind: "task", id: next[1]?.id, what: "made", summary: task.title, by: "rule" },
    ]);
  });

  test("skips the dates missed, so a Task closed late makes one Occurrence and not several", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));
    context.advance(17 * DAY);

    value(await context.call(hand, "finish_task", { id: task.id }));

    expect((await occurrences(context, task)).map((each) => each.due_date)).toEqual([
      "2026-11-16",
      "2026-12-07",
    ]);
  });

  test("by an interval, is due the closing day plus the interval", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-20");
    const recurrence = { kind: "interval", every: 10, unit: "days" } as const;
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence }));
    context.advance(DAY);

    value(await context.call(hand, "finish_task", { id: task.id }));

    const [, next] = await occurrences(context, task);
    expect(next?.due_date).toBe("2026-11-27");
    expect(next?.recurrence).toEqual(recurrence);
  });

  test("follows the rule as changed, and a moved Due Date moves that Occurrence only", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    const fortnightly = { kind: "weeks", every: 2, on: ["monday"] } as const;
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));
    const changed = value(
      await context.call(agent, "set_recurrence", { id: task.id, recurrence: fortnightly }),
    );
    value(await context.call(hand, "finish_task", { id: task.id }));
    const [, second] = await occurrences(context, task);
    expect(second?.due_date).toBe("2026-11-30");
    // Moved off the schedule to a week it skips: the one after is back on it.
    value(await context.call(hand, "set_task_dates", { id: second?.id, due_date: "2026-12-09" }));
    value(await context.call(hand, "finish_task", { id: second?.id }));

    expect(changed.record.due_date).toBe("2026-11-16");
    expect(changed.effects).toEqual([changedByCall(task)]);
    expect((await occurrences(context, task)).map((each) => each.due_date)).toEqual([
      "2026-11-16",
      "2026-12-09",
      "2026-12-14",
    ]);
  });
});

describe("finishing an Occurrence another Task waits on", () => {
  test("releases that Task, which does not wait on the next Occurrence", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Holiday"),
        tasks: [{ title: marked("Leave the keys") }],
      }),
    );
    const keys = entry.tasks[0] as Task;
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));
    value(await context.call(hand, "wait_on", { id: keys.id, on: { kind: "task", id: task.id } }));

    const result = value(await context.call(hand, "finish_task", { id: task.id }));

    const [, next] = await occurrences(context, task);
    expect(result.effects).toEqual([
      changedByCall(task),
      { kind: "task", id: next?.id, what: "made", summary: task.title, by: "rule" },
      { kind: "task", id: keys.id, what: "changed", summary: keys.title, by: "rule" },
    ]);
    const released = value(await context.call(hand, "get_task", { id: keys.id }));
    expect(released.state).toMatchObject({ is: "open", actionable: true, waiting: null });
  });
});

describe("reopening an earlier Occurrence", () => {
  test("gives a plain Task, and finishing it again makes nothing; finishing a Finished one makes nothing", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));
    value(await context.call(hand, "finish_task", { id: task.id }));

    const again = value(await context.call(hand, "finish_task", { id: task.id }));
    const reopened = value(await context.call(hand, "reopen_task", { id: task.id }));
    const refinished = value(await context.call(hand, "finish_task", { id: task.id }));

    expect(again.effects).toEqual([]);
    expect(reopened.record.recurrence).toBeNull();
    expect(refinished.effects).toEqual([changedByCall(task)]);
    const all = await occurrences(context, task);
    expect(all.map((each) => [each.due_date, each.state.is, each.recurrence !== null])).toEqual([
      ["2026-11-16", "finished", false],
      ["2026-11-23", "open", true],
    ]);
  });
});

describe("set_recurrence's refusals", () => {
  test("a Task with no Due Date is refused, and so is a closed one, each named", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Plants"),
        tasks: [{ title: marked("Repot") }],
      }),
    );
    const undated = entry.tasks[0] as Task;
    const closed = await aTaskDue(context, "2026-11-16");
    value(await context.call(hand, "finish_task", { id: closed.id }));

    for (const task of [undated, closed]) {
      const result = await context.call(hand, "set_recurrence", {
        id: task.id,
        recurrence: weekly,
      });
      expect(result).toEqual({
        ok: false,
        error: {
          code: "refused",
          message: expect.any(String),
          in_the_way: [{ kind: "task", id: task.id, summary: task.title }],
        },
      });
    }
  });

  test("setting the rule it has changes nothing, even with weekdays given twice or out of order", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    const recurrence = { kind: "weeks", every: 1, on: ["thursday", "monday"] };
    const first = value(await context.call(hand, "set_recurrence", { id: task.id, recurrence }));
    value(await context.call(hand, "set_task_dates", { id: task.id, due_date: "2026-11-17" }));

    const again = value(
      await context.call(agent, "set_recurrence", {
        id: task.id,
        recurrence: { kind: "weeks", every: 1, on: ["monday", "thursday", "monday"] },
      }),
    );

    expect(first.record.recurrence).toEqual({
      kind: "weeks",
      every: 1,
      on: ["monday", "thursday"],
      from: "2026-11-16",
    });
    expect(again.effects).toEqual([]);
    expect(again.record.recurrence).toEqual(first.record.recurrence);
  });

  test.each([
    ["no weekday", { kind: "weeks", every: 1, on: [] }],
    ["every none", { kind: "days", every: 0 }],
    ["a day of the month past 31", { kind: "months", every: 1, on: 32 }],
    ["an nth weekday", { kind: "months", every: 1, on: "second tuesday" }],
    ["an end date", { kind: "days", every: 1, until: "2027-01-01" }],
    ["the day it counts from", { kind: "days", every: 1, from: "2026-11-01" }],
  ])("a rule with %s is invalid input", async (_, recurrence) => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");

    const result = await context.call(hand, "set_recurrence", { id: task.id, recurrence });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("a Task not in this Context is not found", async () => {
    const context = newContext();
    const elsewhere = await aTaskDue(newContext(), "2026-11-16");

    const result = await context.call(hand, "set_recurrence", {
      id: elsewhere.id,
      recurrence: weekly,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("remove_recurrence", () => {
  test("ends the Recurrence, so closing the Task makes no next Occurrence", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));

    const result = value(await context.call(connection, "remove_recurrence", { id: task.id }));
    const finished = value(await context.call(hand, "finish_task", { id: task.id }));

    expect(result.record).toEqual(task);
    expect(result.effects).toEqual([changedByCall(task)]);
    expect(finished.effects).toEqual([changedByCall(task)]);
    expect(await occurrences(context, task)).toHaveLength(1);
  });

  test("on a Task with no Recurrence changes nothing; one not in this Context is not found", async () => {
    const context = newContext();
    const task = await aTaskDue(context, "2026-11-16");
    const elsewhere = await aTaskDue(newContext(), "2026-11-16");

    const plain = value(await context.call(agent, "remove_recurrence", { id: task.id }));
    const missing = await context.call(agent, "remove_recurrence", { id: elsewhere.id });

    expect(plain).toEqual({ record: task, effects: [], changed: false });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("set_task_dates on a recurring Task", () => {
  test("clearing the Due Date is refused, naming the Task; moving it or the Defer Date is not", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTaskDue(context, "2026-11-16");
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));

    const cleared = await context.call(hand, "set_task_dates", { id: task.id, due_date: null });
    const moved = value(
      await context.call(hand, "set_task_dates", {
        id: task.id,
        due_date: "2026-11-18",
        defer_date: "2026-11-17",
      }),
    );

    expect(cleared).toEqual({
      ok: false,
      error: {
        code: "refused",
        message: expect.any(String),
        in_the_way: [{ kind: "task", id: task.id, summary: task.title }],
      },
    });
    expect(moved.record.recurrence).toEqual({ ...weekly, from: "2026-11-16" });
  });
});

describe("closing a Project", () => {
  test.each([["finish_project"], ["drop_project"]] as const)(
    "by %s ends the Recurrences of the Tasks it drops, each an Effect, and makes no Occurrence",
    async (tool) => {
      const context = newContext("2026-11-16T09:00:00.000Z");
      const task = await aTaskDue(context, "2026-11-16");
      const { record: plants } = value(
        await context.call(hand, "create_project", { name: marked("Plants") }),
      );
      value(await context.call(hand, "move_task", { id: task.id, project_id: plants.id }));
      value(await context.call(hand, "set_recurrence", { id: task.id, recurrence: weekly }));

      const result = value(await context.call(hand, tool, { id: plants.id }));
      const reopened = value(await context.call(hand, "reopen_task", { id: task.id }));

      expect(result.effects).toEqual([
        expect.objectContaining({ kind: "project", id: plants.id, by: "call" }),
        { kind: "task", id: task.id, what: "changed", summary: task.title, by: "rule" },
      ]);
      expect(result.record.tasks).toEqual([
        expect.objectContaining({
          id: task.id,
          recurrence: null,
          state: expect.objectContaining({ is: "dropped" }),
        }),
      ]);
      expect(reopened.record.recurrence).toBeNull();
      expect(await occurrences(context, task)).toHaveLength(1);
    },
  );
});
