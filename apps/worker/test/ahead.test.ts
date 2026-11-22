import type { Ahead, Project, Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { everyCaller, hand, newContext, value } from "./seam.ts";

// The weeks ahead (sections 3.5, 4.10 and 8.3): what is coming in the days after today, derived by
// rule like Attention, with the Occurrences a Recurrence has yet to make worked out from its rule.

type Context = ReturnType<typeof newContext>;

/** A Task the person made on an Entry of its own, given these dates. */
async function aTask(
  context: Context,
  dates: { due_date?: string; defer_date?: string } = {},
  title = marked("Fix the gate"),
): Promise<Task> {
  const { record: entry } = value(
    await context.call(hand, "record_entry", { words: marked("Garden"), tasks: [{ title }] }),
  );
  const task = entry.tasks[0] as Task;
  if (Object.keys(dates).length === 0) return task;
  return value(await context.call(hand, "set_task_dates", { id: task.id, ...dates })).record;
}

async function aProject(context: Context, name: string, due_date: string): Promise<Project> {
  return value(await context.call(hand, "create_project", { name, due_date })).record;
}

async function ahead(context: Context, input: { days?: number } = {}): Promise<Ahead> {
  return value(await context.call(hand, "view_ahead", input));
}

/** What the view lists, each by its day, which of its days that is, and its id. */
async function listed(context: Context, input: { days?: number } = {}) {
  return (await ahead(context, input)).items.map((item) => [
    item.on,
    item.which,
    item.kind === "task"
      ? item.task.id
      : item.kind === "project"
        ? item.project.id
        : `after ${item.occurrence.follows}`,
  ]);
}

describe("view_ahead", () => {
  test("lists the open Tasks and Projects due, and the open Tasks Deferred until a day, in the 28 days after today, by day", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const tomorrow = await aTask(context, { due_date: "2026-11-16" });
    const lastDay = await aTask(context, { due_date: "2026-12-13" });
    const both = await aTask(context, { due_date: "2026-11-25", defer_date: "2026-11-18" });
    const deferred = await aTask(context, { defer_date: "2026-11-20" });
    const project = await aProject(context, marked("Fence"), "2026-11-22");
    // None of these is ahead: due today or before is in Attention's Due, and the rest are past the
    // last day, at an end or in the Trash.
    await aTask(context, { due_date: "2026-11-15" });
    await aTask(context, { due_date: "2026-11-10", defer_date: "2026-11-01" });
    await aTask(context, { due_date: "2026-12-14" });
    const finished = await aTask(context, { due_date: "2026-11-20" });
    value(await context.call(hand, "finish_task", { id: finished.id }));
    const trashed = await aTask(context, { due_date: "2026-11-21" });
    value(await context.call(hand, "delete_task", { id: trashed.id }));
    const dropped = await aProject(context, marked("Pond"), "2026-11-23");
    value(await context.call(hand, "drop_project", { id: dropped.id }));

    const read = await ahead(context);

    expect([read.from, read.to]).toEqual(["2026-11-16", "2026-12-13"]);
    expect(await listed(context)).toEqual([
      ["2026-11-16", "due_date", tomorrow.id],
      ["2026-11-18", "defer_date", both.id],
      ["2026-11-20", "defer_date", deferred.id],
      ["2026-11-22", "due_date", project.id],
      ["2026-11-25", "due_date", both.id],
      ["2026-12-13", "due_date", lastDay.id],
    ]);
    expect(read.items[0]).toEqual({
      on: "2026-11-16",
      which: "due_date",
      kind: "task",
      task: tomorrow,
    });
    expect(read.items[3]).toEqual({
      on: "2026-11-22",
      which: "due_date",
      kind: "project",
      project,
    });
  });

  test("asks for up to 90 days, and fewer than one or more than 90 is invalid input", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const soon = await aTask(context, { due_date: "2026-11-17" });
    const last = await aTask(context, { due_date: "2027-02-13" });
    await aTask(context, { due_date: "2027-02-14" });

    expect((await ahead(context, { days: 90 })).to).toBe("2027-02-13");
    expect(await listed(context, { days: 90 })).toEqual([
      ["2026-11-17", "due_date", soon.id],
      ["2027-02-13", "due_date", last.id],
    ]);
    expect(await listed(context, { days: 1 })).toEqual([]);
    for (const days of [0, 91, 2.5]) {
      expect(await context.call(hand, "view_ahead", { days })).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
  });

  test("works out a Recurrence's future Occurrences from its rule and marks them as not yet existing, until each is made", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context, marked("Garden"), "2027-06-01");
    const title = marked("Water the plants");
    const weekly = await aTask(
      context,
      { due_date: "2026-11-16", defer_date: "2026-11-14" },
      title,
    );
    value(await context.call(hand, "move_task", { id: weekly.id, project_id: project.id }));
    value(
      await context.call(hand, "set_recurrence", {
        id: weekly.id,
        recurrence: { kind: "weeks", every: 1, on: ["monday"] },
      }),
    );

    const read = await ahead(context);

    expect(await listed(context)).toEqual([
      ["2026-11-16", "due_date", weekly.id],
      ["2026-11-21", "defer_date", `after ${weekly.id}`],
      ["2026-11-23", "due_date", `after ${weekly.id}`],
      ["2026-11-28", "defer_date", `after ${weekly.id}`],
      ["2026-11-30", "due_date", `after ${weekly.id}`],
      ["2026-12-05", "defer_date", `after ${weekly.id}`],
      ["2026-12-07", "due_date", `after ${weekly.id}`],
      ["2026-12-12", "defer_date", `after ${weekly.id}`],
    ]);
    expect(read.items[2]).toEqual({
      on: "2026-11-23",
      which: "due_date",
      kind: "future_occurrence",
      occurrence: {
        follows: weekly.id,
        title,
        project: project.id,
        due_date: "2026-11-23",
        defer_date: "2026-11-21",
      },
    });

    // Finished today, the Occurrence due on the 23rd is made, and the ones after it follow it.
    const finished = value(await context.call(hand, "finish_task", { id: weekly.id }));
    const next = finished.effects.find((effect) => effect.what === "made") as { id: string };

    expect(await listed(context)).toEqual([
      ["2026-11-21", "defer_date", next.id],
      ["2026-11-23", "due_date", next.id],
      ["2026-11-28", "defer_date", `after ${next.id}`],
      ["2026-11-30", "due_date", `after ${next.id}`],
      ["2026-12-05", "defer_date", `after ${next.id}`],
      ["2026-12-07", "due_date", `after ${next.id}`],
      ["2026-12-12", "defer_date", `after ${next.id}`],
    ]);
  });

  test("an Overdue Occurrence's future ones are worked out as if it were closed today", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const overdue = await aTask(context, { due_date: "2026-11-10" });
    value(
      await context.call(hand, "set_recurrence", {
        id: overdue.id,
        recurrence: { kind: "interval", every: 10, unit: "days" },
      }),
    );

    expect(await listed(context)).toEqual([
      ["2026-11-25", "due_date", `after ${overdue.id}`],
      ["2026-12-05", "due_date", `after ${overdue.id}`],
    ]);
  });

  test("counts its days from today in the Context's time zone", async () => {
    // 23:30 UTC on the 15th is the 16th in Auckland.
    const context = newContext("2026-11-15T23:30:00.000Z", {
      name: "Personal",
      time_zone: "Pacific/Auckland",
    });
    await aTask(context, { due_date: "2026-11-16" });
    const tomorrow = await aTask(context, { due_date: "2026-11-17" });

    expect((await ahead(context)).from).toBe("2026-11-17");
    expect((await listed(context))[0]).toEqual(["2026-11-17", "due_date", tomorrow.id]);
  });

  test("is the same for every caller", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const task = await aTask(context, { due_date: "2026-11-20" });
    value(
      await context.call(hand, "set_recurrence", {
        id: task.id,
        recurrence: { kind: "days", every: 7 },
      }),
    );
    const read = await ahead(context);

    expect(read.items).toHaveLength(4);
    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "view_ahead", {}))).toEqual(read);
    }
  });
});
