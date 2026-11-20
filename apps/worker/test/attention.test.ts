import type { Attention, Project, Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { DAY, everyCaller, hand, newContext, value } from "./seam.ts";

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

async function aProject(context: Context, name = marked("Garden"), due_date?: string) {
  return value(await context.call(hand, "create_project", { name, due_date })).record;
}

async function aPerson(context: Context) {
  return value(await context.call(hand, "create_person", { name: marked("Alice Moreau") })).record;
}

async function view(context: Context): Promise<Attention> {
  return value(await context.call(hand, "view_attention", {}));
}

/** What each section holds, by id, in its order. */
async function sections(context: Context) {
  const read = await view(context);
  return {
    due: read.due.map((item) => (item.kind === "task" ? item.task.id : item.project.id)),
    newly_actionable: read.newly_actionable.map(({ task }) => task.id),
    delegated: read.delegated.map((task) => task.id),
    projects: read.projects.map(({ project }) => project.id),
    loose: read.loose.map((task) => task.id),
  };
}

const ids = (...records: (Task | Project)[]) => records.map((record) => record.id);

describe("view_attention", () => {
  test("Due holds every open Task Overdue or due today, whatever else holds, and every open Project that is, oldest Due Date first", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const today = await aTask(context, { due_date: "2026-11-15" });
    const delegated = await aTask(context, { due_date: "2026-11-10" });
    value(
      await context.call(hand, "delegate_task", {
        id: delegated.id,
        person_id: (await aPerson(context)).id,
      }),
    );
    const waitedOn = await aTask(context);
    const waiting = await aTask(context, { due_date: "2026-11-12" });
    value(
      await context.call(hand, "wait_on", {
        id: waiting.id,
        on: { kind: "task", id: waitedOn.id },
      }),
    );
    const deferred = await aTask(context, { due_date: "2026-11-14", defer_date: "2026-11-20" });
    const tomorrow = await aTask(context, { due_date: "2026-11-16" });
    const finished = await aTask(context, { due_date: "2026-11-01" });
    value(await context.call(hand, "finish_task", { id: finished.id }));
    const overdue = await aProject(context, marked("Fence"), "2026-11-11");
    const dropped = await aProject(context, marked("Pond"), "2026-11-13");
    value(await context.call(hand, "drop_project", { id: dropped.id }));

    const shown = await sections(context);

    expect(shown.due).toEqual(ids(delegated, overdue, waiting, deferred, today));
    expect(shown.loose).toEqual(ids(waitedOn, tomorrow));
  });

  test("Delegated holds every other Delegated Task, oldest delegation first, and a Waiting or Deferred Task not due is not shown", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const alice = await aPerson(context);
    const delegate = (task: Task) =>
      context.call(hand, "delegate_task", { id: task.id, person_id: alice.id });
    const [later, earlier] = [await aTask(context), await aTask(context)];
    value(await delegate(earlier));
    context.advance(DAY);
    value(await delegate(later));
    const delegatedAndDeferred = await aTask(context, { defer_date: "2026-12-01" });
    value(await delegate(delegatedAndDeferred));
    const deferred = await aTask(context, { defer_date: "2026-12-01", due_date: "2026-12-05" });
    const waitedOn = await aTask(context);
    const waiting = await aTask(context);
    value(
      await context.call(hand, "wait_on", {
        id: waiting.id,
        on: { kind: "task", id: waitedOn.id },
      }),
    );

    const shown = await sections(context);

    expect(shown.delegated).toEqual(ids(earlier, later));
    expect(Object.values(shown).flat()).not.toContain(delegatedAndDeferred.id);
    expect(Object.values(shown).flat()).not.toContain(deferred.id);
    expect(Object.values(shown).flat()).not.toContain(waiting.id);
    expect(shown.loose).toEqual(ids(waitedOn));
  });

  test("Newly actionable holds actionable Tasks whose wait ended, that were taken back or whose Defer Date came, newest first, for seven days", async () => {
    const context = newContext("2026-11-10T09:00:00.000Z");
    const waitedOn = await aTask(context);
    const released = await aTask(context);
    value(
      await context.call(hand, "wait_on", {
        id: released.id,
        on: { kind: "task", id: waitedOn.id },
      }),
    );
    const project = await aProject(context);
    const undeferred = await aTask(context, { defer_date: "2026-11-15" });
    value(await context.call(hand, "move_task", { id: undeferred.id, project_id: project.id }));
    const takenBack = await aTask(context);
    value(
      await context.call(hand, "delegate_task", {
        id: takenBack.id,
        person_id: (await aPerson(context)).id,
      }),
    );
    // Never Deferred: its Defer Date had come when it was made.
    const neverDeferred = await aTask(context, { defer_date: "2026-11-10" });
    context.advance(2 * DAY);
    value(await context.call(hand, "finish_task", { id: waitedOn.id }));
    context.advance(2 * DAY);
    value(await context.call(hand, "take_back_task", { id: takenBack.id }));
    context.advance(DAY);

    const read = await view(context);

    expect(read.newly_actionable.map(({ task, came_up }) => [task.id, came_up])).toEqual([
      [undeferred.id, { because: "defer_date_came", on: "2026-11-15" }],
      [takenBack.id, { because: "taken_back", at: "2026-11-14T09:00:00.000Z" }],
      [released.id, { because: "wait_ended", at: "2026-11-12T09:00:00.000Z" }],
    ]);
    expect((await sections(context)).loose).toEqual(ids(neverDeferred));

    // Listed the day it came up and the six after, then placed as any other.
    context.advance(3 * DAY);
    expect((await sections(context)).newly_actionable).toEqual(
      ids(undeferred, takenBack, released),
    );
    context.advance(DAY);
    expect(await sections(context)).toMatchObject({
      newly_actionable: ids(undeferred, takenBack),
      loose: ids(released, neverDeferred),
    });
    context.advance(3 * DAY);
    // In a Project, it is reached through the Project once it is no longer listed apart.
    expect(await sections(context)).toMatchObject({
      newly_actionable: [],
      loose: ids(released, takenBack, neverDeferred),
    });
  });

  test("Projects holds every open Project by name with its count of actionable Tasks and its Tasks, flagged when it has no open Task, and one in Due is still there", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    // Names with no marker, which would lead them and decide the order.
    const kitchen = await aProject(context, "Kitchen", "2026-11-15");
    const bathroom = await aProject(context, "bathroom");
    const attic = await aProject(context, "Attic");
    const closed = await aProject(context, "Cellar");
    value(await context.call(hand, "finish_project", { id: closed.id }));
    const inKitchen = async (dates: { due_date?: string; defer_date?: string } = {}) => {
      const task = await aTask(context, dates);
      return value(await context.call(hand, "move_task", { id: task.id, project_id: kitchen.id }))
        .record;
    };
    const [first, deferred, second] = [
      await inKitchen(),
      await inKitchen({ defer_date: "2026-12-01" }),
      await inKitchen(),
    ];
    const finished = await aTask(context);
    value(await context.call(hand, "move_task", { id: finished.id, project_id: attic.id }));
    value(await context.call(hand, "finish_task", { id: finished.id }));

    const read = await view(context);

    expect(read.due.map((item) => item.kind === "project" && item.project.id)).toEqual([
      kitchen.id,
    ]);
    expect(
      read.projects.map(({ project, actionable_tasks, no_open_task }) => ({
        id: project.id,
        tasks: project.tasks.map((task) => task.id),
        actionable_tasks,
        no_open_task,
      })),
    ).toEqual([
      { id: attic.id, tasks: [finished.id], actionable_tasks: 0, no_open_task: true },
      { id: bathroom.id, tasks: [], actionable_tasks: 0, no_open_task: true },
      {
        id: kitchen.id,
        tasks: ids(first, deferred, second),
        actionable_tasks: 2,
        no_open_task: false,
      },
    ]);
    // Its actionable Tasks are reached through it, not listed apart.
    expect(read.loose).toEqual([]);
  });

  test("a Task appears once, in the first section it fits", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const alice = await aPerson(context);
    const dueAndDelegated = await aTask(context, { due_date: "2026-11-15" });
    const dueAndTakenBack = await aTask(context, { due_date: "2026-11-01" });
    const takenBack = await aTask(context);
    for (const task of [dueAndDelegated, dueAndTakenBack, takenBack]) {
      value(await context.call(hand, "delegate_task", { id: task.id, person_id: alice.id }));
    }
    for (const task of [dueAndTakenBack, takenBack]) {
      value(await context.call(hand, "take_back_task", { id: task.id }));
    }

    expect(await sections(context)).toEqual({
      due: ids(dueAndTakenBack, dueAndDelegated),
      newly_actionable: ids(takenBack),
      delegated: [],
      projects: [],
      loose: [],
    });
  });

  test("holds Tasks with their state and Projects only, and is the same for every caller", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context, marked("Fence"), "2026-11-14");
    // Of one Due Date, the one made first comes first.
    context.advance(60 * 1000);
    const task = await aTask(context, { due_date: "2026-11-14" });

    const read = await view(context);

    expect(read).toEqual({
      due: [
        {
          kind: "project",
          project: { ...project, state: { is: "open", overdue: { since: "2026-11-15" } } },
        },
        {
          kind: "task",
          task: { ...task, state: { ...task.state, overdue: { since: "2026-11-15" } } },
        },
      ],
      newly_actionable: [],
      delegated: [],
      projects: [
        {
          project: { ...project, state: { is: "open", overdue: { since: "2026-11-15" } } },
          actionable_tasks: 0,
          no_open_task: true,
        },
      ],
      loose: [],
    });
    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "view_attention", {}))).toEqual(read);
    }
  });

  test("a wait stopped by hand ends it, and what ended before a Task was reopened does not bring it up", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [waitedOn, stopped, reopened] = [
      await aTask(context),
      await aTask(context),
      await aTask(context),
    ];
    for (const task of [stopped, reopened]) {
      value(
        await context.call(hand, "wait_on", { id: task.id, on: { kind: "task", id: waitedOn.id } }),
      );
    }
    value(
      await context.call(hand, "stop_waiting", {
        id: stopped.id,
        on: { kind: "task", id: waitedOn.id },
      }),
    );
    value(
      await context.call(hand, "stop_waiting", {
        id: reopened.id,
        on: { kind: "task", id: waitedOn.id },
      }),
    );
    value(await context.call(hand, "finish_task", { id: reopened.id }));
    value(await context.call(hand, "reopen_task", { id: reopened.id }));

    const read = await view(context);

    expect(read.newly_actionable).toEqual([
      {
        task: expect.objectContaining({ id: stopped.id }),
        came_up: { because: "wait_ended", at: "2026-11-15T09:00:00.000Z" },
      },
    ]);
    expect(read.loose.map((task) => task.id)).toEqual(ids(waitedOn, reopened));
  });

  test("a Defer Date that came before the Task was last reopened does not bring it up", async () => {
    const context = newContext("2026-11-10T09:00:00.000Z");
    const task = await aTask(context, { defer_date: "2026-11-12" });
    value(await context.call(hand, "finish_task", { id: task.id }));
    context.advance(3 * DAY);
    value(await context.call(hand, "reopen_task", { id: task.id }));

    expect(await sections(context)).toMatchObject({ newly_actionable: [], loose: ids(task) });
  });
});
