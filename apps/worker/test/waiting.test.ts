import type { Project, Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, hand, newContext, readOnlyConnection, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

async function aTask(context: Context, title = marked("Fit the cupboards")): Promise<Task> {
  const { record: entry } = value(
    await context.call(hand, "record_entry", { words: marked("Kitchen"), tasks: [{ title }] }),
  );
  return entry.tasks[0] as Task;
}

async function aProject(context: Context, name = marked("Kitchen")): Promise<Project> {
  return value(await context.call(hand, "create_project", { name })).record;
}

const onTask = (task: Task) => ({ kind: "task", id: task.id }) as const;
const onProject = (project: Project) => ({ kind: "project", id: project.id }) as const;

/** The state of an open Task with no dates that waits on these, each since then. */
function waitingOn(...waits: { on: Task | Project; since: string }[]) {
  return {
    is: "open",
    actionable: false,
    waiting: waits.map(({ on, since }) => ({
      on:
        "title" in on
          ? { kind: "task", id: on.id, title: on.title }
          : { kind: "project", id: on.id, name: on.name },
      since,
    })),
    delegated: null,
    deferred: null,
    overdue: null,
  };
}

const actionable = {
  is: "open",
  actionable: true,
  waiting: null,
  delegated: null,
  deferred: null,
  overdue: null,
};

const changedByCall = (task: Task) => ({
  kind: "task",
  id: task.id,
  what: "changed",
  summary: task.title,
  by: "call",
});

describe("wait_on", () => {
  test("sets a Task waiting on a Task and a Project, across Projects, read with what and since when", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [cupboards, plumbing] = [await aTask(context), await aTask(context, marked("Plumbing"))];
    const [kitchen, bathroom] = [await aProject(context), await aProject(context, marked("Bath"))];
    value(await context.call(hand, "move_task", { id: cupboards.id, project_id: kitchen.id }));
    value(await context.call(hand, "move_task", { id: plumbing.id, project_id: bathroom.id }));
    context.advance(DAY);

    const onPlumbing = value(
      await context.call(connection, "wait_on", { id: cupboards.id, on: onTask(plumbing) }),
    );
    context.advance(DAY);
    const onBathroom = value(
      await context.call(agent, "wait_on", { id: cupboards.id, on: onProject(bathroom) }),
    );

    const first = { on: plumbing, since: "2026-11-16T09:00:00.000Z" };
    const second = { on: bathroom, since: "2026-11-17T09:00:00.000Z" };
    expect(onPlumbing.record.state).toEqual(waitingOn(first));
    expect(onPlumbing.effects).toEqual([changedByCall(cupboards)]);
    expect(onBathroom.record).toEqual({
      ...cupboards,
      project: kitchen.id,
      state: waitingOn(first, second),
    });
    expect(onBathroom.effects).toEqual([changedByCall(cupboards)]);
    expect(
      value(await context.call(readOnlyConnection, "get_task", { id: cupboards.id })).state,
    ).toEqual(waitingOn(first, second));
    expect(value(await context.call(hand, "get_task", { id: plumbing.id })).state).toEqual(
      actionable,
    );
  });
});

describe("wait_on, refused or not found", () => {
  test("waiting on what it already waits on changes nothing", async () => {
    const context = newContext();
    const [cupboards, plumbing] = [await aTask(context), await aTask(context, marked("Plumbing"))];
    const first = value(
      await context.call(hand, "wait_on", { id: cupboards.id, on: onTask(plumbing) }),
    );
    context.advance(DAY);

    expect(
      value(await context.call(agent, "wait_on", { id: cupboards.id, on: onTask(plumbing) })),
    ).toEqual({ record: first.record, effects: [], changed: false });
  });

  test("a closed Task is refused a wait until it is reopened, and the refusal names it", async () => {
    const context = newContext();
    const [finished, dropped] = [await aTask(context), await aTask(context, marked("Tiles"))];
    const plumbing = await aTask(context, marked("Plumbing"));
    value(await context.call(hand, "finish_task", { id: finished.id }));
    value(await context.call(hand, "drop_task", { id: dropped.id }));

    for (const task of [finished, dropped]) {
      expect(await context.call(agent, "wait_on", { id: task.id, on: onTask(plumbing) })).toEqual(
        refusedFor(task),
      );
    }
  });

  test("waiting on a closed Task or Project is refused, and the refusal names it", async () => {
    const context = newContext();
    const [cupboards, plumbing] = [await aTask(context), await aTask(context, marked("Plumbing"))];
    const kitchen = await aProject(context);
    value(await context.call(hand, "drop_task", { id: plumbing.id }));
    value(await context.call(hand, "finish_project", { id: kitchen.id }));

    expect(await context.call(hand, "wait_on", { id: cupboards.id, on: onTask(plumbing) })).toEqual(
      refusedFor(plumbing),
    );
    expect(
      await context.call(hand, "wait_on", { id: cupboards.id, on: onProject(kitchen) }),
    ).toEqual(refusedFor(kitchen));
  });

  test("never on a Person, nor on a Task or Project in another Context", async () => {
    const context = newContext();
    const elsewhere = newContext();
    const cupboards = await aTask(context);
    const [otherTask, otherProject] = [await aTask(elsewhere), await aProject(elsewhere)];
    const { record: alice } = value(
      await context.call(hand, "create_person", { name: marked("Alice") }),
    );

    for (const on of [
      onTask(otherTask),
      onProject(otherProject),
      { kind: "task", id: alice.id },
      { kind: "project", id: alice.id },
    ]) {
      const result = await context.call(hand, "wait_on", { id: cupboards.id, on });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    const onAPerson = await context.call(hand, "wait_on", {
      id: cupboards.id,
      on: { kind: "person", id: alice.id },
    });
    expect(onAPerson).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      await context.call(hand, "wait_on", { id: otherTask.id, on: onTask(cupboards) }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

/** A refusal naming these Tasks or Projects as in the way, in this order. */
function refusedFor(...inTheWay: (Task | Project)[]) {
  return {
    ok: false,
    error: {
      code: "refused",
      message: expect.any(String),
      in_the_way: inTheWay.map((record) =>
        "title" in record
          ? { kind: "task", id: record.id, summary: record.title }
          : { kind: "project", id: record.id, summary: record.name },
      ),
    },
  };
}

describe("a wait that would make a cycle", () => {
  test("is refused, listing each Task whose wait closes it, from the one to be waited on", async () => {
    const context = newContext();
    const [a, b, c] = [
      await aTask(context, marked("Order the worktop")),
      await aTask(context, marked("Measure the walls")),
      await aTask(context, marked("Clear the room")),
    ];
    value(await context.call(hand, "wait_on", { id: a.id, on: onTask(b) }));
    value(await context.call(hand, "wait_on", { id: b.id, on: onTask(c) }));

    expect(await context.call(agent, "wait_on", { id: c.id, on: onTask(a) })).toEqual(
      refusedFor(a, b),
    );
    expect(await context.call(agent, "wait_on", { id: b.id, on: onTask(a) })).toEqual(
      refusedFor(a),
    );
    expect(await context.call(connection, "wait_on", { id: a.id, on: onTask(a) })).toEqual(
      refusedFor(a),
    );
  });

  test("is judged on the waits that still hold: one that ended closes no cycle", async () => {
    const context = newContext();
    const [a, b] = [await aTask(context), await aTask(context, marked("Measure the walls"))];
    value(await context.call(hand, "wait_on", { id: a.id, on: onTask(b) }));
    value(await context.call(hand, "stop_waiting", { id: a.id, on: onTask(b) }));

    const result = value(await context.call(hand, "wait_on", { id: b.id, on: onTask(a) }));

    expect(result.record.state).toMatchObject({ waiting: [{ on: { id: a.id } }] });
  });
});

describe("stop_waiting", () => {
  test("ends one wait, and the Task is actionable once none is left", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [cupboards, plumbing] = [await aTask(context), await aTask(context, marked("Plumbing"))];
    const kitchen = await aProject(context);
    value(await context.call(hand, "wait_on", { id: cupboards.id, on: onTask(plumbing) }));
    value(await context.call(hand, "wait_on", { id: cupboards.id, on: onProject(kitchen) }));
    context.advance(DAY);

    const one = value(
      await context.call(connection, "stop_waiting", { id: cupboards.id, on: onTask(plumbing) }),
    );
    const none = value(
      await context.call(agent, "stop_waiting", { id: cupboards.id, on: onProject(kitchen) }),
    );

    expect(one.record.state).toEqual(waitingOn({ on: kitchen, since: "2026-11-15T09:00:00.000Z" }));
    expect(one.effects).toEqual([changedByCall(cupboards)]);
    expect(none.record).toEqual({ ...cupboards, state: actionable });
    expect(none.effects).toEqual([changedByCall(cupboards)]);
  });

  test("stopping a wait the Task does not have changes nothing", async () => {
    const context = newContext();
    const [cupboards, plumbing] = [await aTask(context), await aTask(context, marked("Plumbing"))];

    expect(
      value(await context.call(hand, "stop_waiting", { id: cupboards.id, on: onTask(plumbing) })),
    ).toEqual({ record: cupboards, effects: [], changed: false });
  });

  test("a Task, or a Task or Project to stop waiting on, not in this Context is not found", async () => {
    const elsewhere = newContext();
    const [otherTask, otherProject] = [await aTask(elsewhere), await aProject(elsewhere)];
    const context = newContext();
    const task = await aTask(context);

    for (const input of [
      { id: otherTask.id, on: onTask(task) },
      { id: task.id, on: onTask(otherTask) },
      { id: task.id, on: onProject(otherProject) },
    ]) {
      const result = await context.call(hand, "stop_waiting", input);
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });
});

const changedByRule = (task: Task) => ({ ...changedByCall(task), by: "rule" });

describe("a wait", () => {
  test.each(["finish_task", "drop_task"] as const)(
    "ends when the Task waited on is closed by %s, each Task released an Effect by rule",
    async (tool) => {
      const context = newContext("2026-11-15T09:00:00.000Z");
      const plumbing = await aTask(context, marked("Plumbing"));
      const [cupboards, tiles] = [await aTask(context), await aTask(context, marked("Tiles"))];
      const kitchen = await aProject(context);
      value(await context.call(hand, "wait_on", { id: cupboards.id, on: onTask(plumbing) }));
      value(await context.call(hand, "wait_on", { id: tiles.id, on: onTask(plumbing) }));
      value(await context.call(hand, "wait_on", { id: tiles.id, on: onProject(kitchen) }));
      context.advance(DAY);

      const closed = value(await context.call(agent, tool, { id: plumbing.id }));

      expect(closed.effects).toEqual([
        changedByCall(plumbing),
        changedByRule(cupboards),
        changedByRule(tiles),
      ]);
      expect(value(await context.call(hand, "get_task", { id: cupboards.id })).state).toEqual(
        actionable,
      );
      expect(value(await context.call(hand, "get_task", { id: tiles.id })).state).toEqual(
        waitingOn({ on: kitchen, since: "2026-11-15T09:00:00.000Z" }),
      );
    },
  );

  test.each(["finish_project", "drop_project"] as const)(
    "ends when the Project waited on is closed by %s, or a Task it drops, each an Effect by rule",
    async (tool) => {
      const context = newContext();
      const kitchen = await aProject(context);
      const plumbing = await aTask(context, marked("Plumbing"));
      const [cupboards, tiles] = [await aTask(context), await aTask(context, marked("Tiles"))];
      value(await context.call(hand, "move_task", { id: plumbing.id, project_id: kitchen.id }));
      value(await context.call(hand, "wait_on", { id: cupboards.id, on: onProject(kitchen) }));
      value(await context.call(hand, "wait_on", { id: tiles.id, on: onTask(plumbing) }));

      const closed = value(await context.call(connection, tool, { id: kitchen.id }));

      expect(closed.effects).toEqual([
        { kind: "project", id: kitchen.id, what: "changed", summary: kitchen.name, by: "call" },
        changedByRule(plumbing),
        changedByRule(cupboards),
        changedByRule(tiles),
      ]);
      for (const task of [cupboards, tiles]) {
        expect(value(await context.call(hand, "get_task", { id: task.id })).state).toEqual(
          actionable,
        );
      }
    },
  );

  test("a Task in the closed Project waiting on another there is dropped, not released besides", async () => {
    const context = newContext();
    const kitchen = await aProject(context);
    const [cupboards, plumbing] = [await aTask(context), await aTask(context, marked("Plumbing"))];
    for (const task of [cupboards, plumbing]) {
      value(await context.call(hand, "move_task", { id: task.id, project_id: kitchen.id }));
    }
    value(await context.call(hand, "wait_on", { id: cupboards.id, on: onTask(plumbing) }));
    value(await context.call(hand, "wait_on", { id: cupboards.id, on: onProject(kitchen) }));

    const closed = value(await context.call(hand, "drop_project", { id: kitchen.id }));

    expect(closed.effects).toEqual([
      { kind: "project", id: kitchen.id, what: "changed", summary: kitchen.name, by: "call" },
      changedByRule(cupboards),
      changedByRule(plumbing),
    ]);
  });

  test("reopening what was waited on does not bring the wait back", async () => {
    const context = newContext();
    const [cupboards, plumbing] = [await aTask(context), await aTask(context, marked("Plumbing"))];
    const kitchen = await aProject(context);
    value(await context.call(hand, "wait_on", { id: cupboards.id, on: onTask(plumbing) }));
    value(await context.call(hand, "wait_on", { id: cupboards.id, on: onProject(kitchen) }));
    value(await context.call(hand, "finish_task", { id: plumbing.id }));
    value(await context.call(hand, "drop_project", { id: kitchen.id }));

    const reopened = value(await context.call(hand, "reopen_task", { id: plumbing.id }));
    const reopenedProject = value(await context.call(hand, "reopen_project", { id: kitchen.id }));

    expect(reopened.effects).toEqual([changedByCall(plumbing)]);
    expect(reopenedProject.effects).toHaveLength(1);
    expect(value(await context.call(hand, "get_task", { id: cupboards.id })).state).toEqual(
      actionable,
    );
  });
});

describe("a Waiting Task", () => {
  test.each(["finish_task", "drop_task"] as const)(
    "can be closed by %s, which leaves what it waited on untouched, and reopening brings back no wait",
    async (tool) => {
      const context = newContext();
      const [cupboards, plumbing] = [
        await aTask(context),
        await aTask(context, marked("Plumbing")),
      ];
      value(await context.call(hand, "wait_on", { id: cupboards.id, on: onTask(plumbing) }));

      const closed = value(await context.call(hand, tool, { id: cupboards.id }));
      const reopened = value(await context.call(hand, "reopen_task", { id: cupboards.id }));

      expect(closed.effects).toEqual([changedByCall(cupboards)]);
      expect(reopened.record.state).toEqual(actionable);
      expect(value(await context.call(hand, "get_task", { id: plumbing.id }))).toEqual(plumbing);
    },
  );
});
