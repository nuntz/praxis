import type { Project, Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, everyCaller, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** An open Project with no Due Date. */
const open = { is: "open", overdue: null };

/** A Project made by the person, with no Tasks. */
async function aProject(context: Context, name = marked("Move house")) {
  return value(await context.call(hand, "create_project", { name })).record;
}

describe("create_project", () => {
  test("makes an open Project with a name, no Due Date and no Tasks, read by every caller", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const name = marked("Move house");

    const result = value(await context.call(agent, "create_project", { name }));

    const project = {
      id: expect.any(String),
      name,
      at: "2026-11-15T09:00:00.000Z",
      due_date: null,
      state: open,
      tasks: [],
    };
    expect(result.record).toEqual(project);
    expect(result.effects).toEqual([
      { kind: "project", id: result.record.id, what: "made", summary: name, by: "call" },
    ]);
    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "get_project", { id: result.record.id }))).toEqual(
        result.record,
      );
    }
  });

  test("can be given a Due Date", async () => {
    const context = newContext();

    const { record } = value(
      await context.call(hand, "create_project", {
        name: marked("Taxes"),
        due_date: "2027-04-15",
      }),
    );

    expect(record.due_date).toBe("2027-04-15");
  });

  test("two Projects may share a name and are two Projects", async () => {
    const context = newContext();
    const name = marked("Garden");

    const first = await aProject(context, name);
    const second = await aProject(context, name);

    expect(first.id).not.toBe(second.id);
    expect([first.name, second.name]).toEqual([name, name]);
  });

  test("a Project has a name of one line and no description", async () => {
    const context = newContext();

    for (const input of [
      { name: " " },
      { name: marked("Two\nlines") },
      { name: marked("Named"), description: marked("No description") },
      { name: marked("Named"), due_date: "next Friday" },
      {},
    ]) {
      const result = await context.call(hand, "create_project", input);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "list_projects", {})).items).toEqual([]);
  });
});

describe("get_project", () => {
  test("a Project not in this Context is not found", async () => {
    const context = newContext();
    const elsewhere = await aProject(newContext());

    for (const id of [elsewhere.id, "no-such-project"]) {
      const result = await context.call(hand, "get_project", { id });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });
});

describe("rename_project", () => {
  test("changes a Project's name and nothing else", async () => {
    const context = newContext();
    const project = await aProject(context);
    const name = marked("Move flat");

    const result = value(
      await context.call(connection, "rename_project", { id: project.id, name }),
    );

    expect(result.record).toEqual({ ...project, name });
    expect(result.effects).toEqual([
      { kind: "project", id: project.id, what: "changed", summary: name, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_project", { id: project.id }))).toEqual(
      result.record,
    );
  });

  test("renaming a Project to the name it has changes nothing", async () => {
    const context = newContext();
    const project = await aProject(context);

    expect(
      value(await context.call(hand, "rename_project", { id: project.id, name: project.name })),
    ).toEqual({ record: project, effects: [], changed: false });
  });

  test("a name is one line with words in it, and a Project not here is not found", async () => {
    const context = newContext();
    const project = await aProject(context);

    for (const name of ["", marked("One\nTwo")]) {
      const result = await context.call(hand, "rename_project", { id: project.id, name });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    const result = await context.call(hand, "rename_project", {
      id: "no-such-project",
      name: marked("Renamed"),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("set_project_due_date", () => {
  test("sets a Due Date, and an open Project past it is Overdue from the day after", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context);

    const result = value(
      await context.call(agent, "set_project_due_date", { id: project.id, due_date: "2026-11-10" }),
    );

    const dated = {
      ...project,
      due_date: "2026-11-10",
      state: { is: "open", overdue: { since: "2026-11-11" } },
    };
    expect(result.record).toEqual(dated);
    expect(result.effects).toEqual([
      { kind: "project", id: project.id, what: "changed", summary: project.name, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_project", { id: project.id }))).toEqual(dated);
  });

  test("is not Overdue on its Due Date, judged by today in the Context's time zone", async () => {
    // Noon on the 15th in London is already the 16th in Auckland.
    const states = [];
    for (const time_zone of ["Europe/London", "Pacific/Auckland"]) {
      const context = newContext("2026-11-15T12:00:00.000Z", { name: "Work", time_zone });
      const project = await aProject(context);
      const { record } = value(
        await context.call(hand, "set_project_due_date", {
          id: project.id,
          due_date: "2026-11-15",
        }),
      );
      states.push(record.state);
    }

    expect(states).toEqual([
      { is: "open", overdue: null },
      { is: "open", overdue: { since: "2026-11-16" } },
    ]);
  });

  test("a Project's Due Date says nothing about its Tasks'", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context);
    const task = await aTaskIn(context, project);

    const { record } = value(
      await context.call(hand, "set_project_due_date", { id: project.id, due_date: "2026-11-01" }),
    );

    expect(record.tasks).toEqual([task]);
    expect(value(await context.call(hand, "get_task", { id: task.id })).due_date).toBeNull();
  });

  test("clears it with null, and the date it has changes nothing", async () => {
    const context = newContext();
    const project = await aProject(context);
    const set = (due_date: string | null) =>
      context.call(hand, "set_project_due_date", { id: project.id, due_date }).then(value);

    const first = await set("2026-12-01");
    const again = await set("2026-12-01");
    const cleared = await set(null);

    expect(again).toEqual({ record: first.record, effects: [], changed: false });
    expect(cleared.record).toEqual(project);
    expect(cleared.changed).toBe(true);
  });

  test("a Due Date is a day, never prose, and must be given", async () => {
    const context = newContext();
    const project = await aProject(context);

    for (const dates of [{ due_date: "next Friday" }, { due_date: "2026-11-20T09:00:00Z" }, {}]) {
      const result = await context.call(hand, "set_project_due_date", { id: project.id, ...dates });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    const result = await context.call(hand, "set_project_due_date", {
      id: "no-such-project",
      due_date: null,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

/** A Task the person recorded and put in a Project, as it reads once there. */
async function aTaskIn(context: Context, project: Project, title = marked("Book the van")) {
  const { record: entry } = value(
    await context.call(hand, "record_entry", { words: marked("Moving"), tasks: [{ title }] }),
  );
  const task = entry.tasks[0] as Task;
  return value(await context.call(hand, "move_task", { id: task.id, project_id: project.id }))
    .record;
}

describe("move_task", () => {
  test("a Task joins a Project, and the Project reads it among its Tasks", async () => {
    const context = newContext();
    const project = await aProject(context);
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Moving"),
        tasks: [{ title: marked("Book the van") }],
      }),
    );
    const task = entry.tasks[0] as Task;

    const result = value(
      await context.call(agent, "move_task", { id: task.id, project_id: project.id }),
    );

    const joined = { ...task, project: project.id };
    expect(result.record).toEqual(joined);
    expect(result.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_project", { id: project.id })).tasks).toEqual([
      joined,
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).tasks).toEqual([joined]);
  });

  test("a Task changes Project, and leaves any with null, keeping its Origin Entry and Author", async () => {
    const context = newContext();
    const [from, to] = [await aProject(context), await aProject(context)];
    const task = await aTaskIn(context, from);

    const changed = value(
      await context.call(connection, "move_task", { id: task.id, project_id: to.id }),
    );
    const left = value(await context.call(hand, "move_task", { id: task.id, project_id: null }));

    expect(changed.record).toEqual({ ...task, project: to.id });
    expect(left.record).toEqual({ ...task, project: null });
    expect(left.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
    const projects = value(await context.call(hand, "list_projects", {})).items;
    expect(projects.map((each) => each.tasks)).toEqual([[], []]);
  });

  test("a Task of any state can be moved, and its state stays as it was", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context);
    const task = await aTaskIn(context, project);
    value(await context.call(hand, "finish_task", { id: task.id }));

    const { record } = value(
      await context.call(hand, "move_task", { id: task.id, project_id: null }),
    );

    expect(record.state).toEqual({ is: "finished", at: "2026-11-15T09:00:00.000Z" });
  });

  test("moving a Task to where it is changes nothing", async () => {
    const context = newContext();
    const project = await aProject(context);
    const task = await aTaskIn(context, project);
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Loose"),
        tasks: [{ title: marked("No Project") }],
      }),
    );
    const loose = entry.tasks[0] as Task;

    expect(
      value(await context.call(hand, "move_task", { id: task.id, project_id: project.id })),
    ).toEqual({ record: task, effects: [], changed: false });
    expect(
      value(await context.call(hand, "move_task", { id: loose.id, project_id: null })),
    ).toEqual({ record: loose, effects: [], changed: false });
  });

  test("the Task and the Project must both be in this Context", async () => {
    const context = newContext();
    const elsewhere = newContext();
    const project = await aProject(context);
    const theirs = await aProject(elsewhere);
    const task = await aTaskIn(context, project);
    const theirTask = await aTaskIn(elsewhere, theirs);

    for (const input of [
      { id: task.id, project_id: theirs.id },
      { id: task.id, project_id: "no-such-project" },
      { id: theirTask.id, project_id: project.id },
      { id: "no-such-task", project_id: null },
    ]) {
      const result = await context.call(hand, "move_task", input);
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    const result = await context.call(hand, "move_task", { id: task.id });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("a Project's Tasks running out", () => {
  test("never finishes it: it stays open until declared", async () => {
    const context = newContext();
    const project = await aProject(context);
    const task = await aTaskIn(context, project);

    value(await context.call(hand, "finish_task", { id: task.id }));

    expect(value(await context.call(hand, "get_project", { id: project.id })).state).toEqual(open);
  });
});

describe("finish_project", () => declaresAnEnd("finish_project", "finished"));

describe("drop_project", () => declaresAnEnd("drop_project", "dropped"));

/** What finishing and dropping a Project have in common: each is one end, declared. */
function declaresAnEnd(tool: "finish_project" | "drop_project", end: "finished" | "dropped") {
  test(`declares a Project ${end}, with when, and drops each Task still open in it by rule`, async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context);
    const [finished, dropped, stillOpen] = [
      await aTaskIn(context, project, marked("Finished first")),
      await aTaskIn(context, project, marked("Dropped first")),
      await aTaskIn(context, project, marked("Still open")),
    ];
    value(await context.call(hand, "finish_task", { id: finished.id }));
    value(await context.call(hand, "drop_task", { id: dropped.id }));
    const elsewhere = await aTaskIn(context, await aProject(context), marked("Elsewhere"));
    context.advance(DAY);

    const result = value(await context.call(agent, tool, { id: project.id }));

    const at = "2026-11-16T09:00:00.000Z";
    const read = (task: Task) => context.call(hand, "get_task", { id: task.id }).then(value);
    const droppedByRule = { ...stillOpen, state: { is: "dropped", at } };
    expect(result.record).toEqual({
      ...project,
      state: { is: end, at },
      tasks: [await read(finished), await read(dropped), droppedByRule],
    });
    expect(result.effects).toEqual([
      { kind: "project", id: project.id, what: "changed", summary: project.name, by: "call" },
      { kind: "task", id: stillOpen.id, what: "changed", summary: stillOpen.title, by: "rule" },
    ]);
    expect(await read(stillOpen)).toEqual(droppedByRule);
    expect((await read(finished)).state).toEqual({
      is: "finished",
      at: "2026-11-15T09:00:00.000Z",
    });
    expect(await read(elsewhere)).toEqual(elsewhere);
  });

  test("declaring the end it is at changes nothing", async () => {
    const context = newContext();
    const project = await aProject(context);
    const first = value(await context.call(hand, tool, { id: project.id }));
    context.advance(DAY);

    expect(value(await context.call(connection, tool, { id: project.id }))).toEqual({
      record: first.record,
      effects: [],
      changed: false,
    });
  });

  test("a Project not in this Context is not found", async () => {
    const context = newContext();
    const theirs = await aProject(newContext());

    for (const id of [theirs.id, "no-such-project"]) {
      const result = await context.call(hand, tool, { id });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });
}

describe("closing a Project", () => {
  test("is never refused: a Project at one end is declared at the other directly", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context);
    value(await context.call(hand, "drop_project", { id: project.id }));
    context.advance(DAY);

    const result = value(await context.call(hand, "finish_project", { id: project.id }));

    expect(result.record.state).toEqual({ is: "finished", at: "2026-11-16T09:00:00.000Z" });
    expect(result.effects).toEqual([
      { kind: "project", id: project.id, what: "changed", summary: project.name, by: "call" },
    ]);
  });

  test("drops a Task reopened in it since it closed, when it is declared again", async () => {
    const context = newContext();
    const project = await aProject(context);
    const task = await aTaskIn(context, project);
    value(await context.call(hand, "finish_project", { id: project.id }));
    value(await context.call(hand, "reopen_task", { id: task.id }));

    const result = value(await context.call(hand, "drop_project", { id: project.id }));

    expect(result.effects).toEqual([
      expect.objectContaining({ kind: "project", by: "call" }),
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "rule" },
    ]);
  });

  test("an Overdue Project that is closed is no longer Overdue", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { record: project } = value(
      await context.call(hand, "create_project", { name: marked("Late"), due_date: "2026-11-01" }),
    );

    const { record } = value(await context.call(hand, "finish_project", { id: project.id }));

    expect(project.state).toEqual({ is: "open", overdue: { since: "2026-11-02" } });
    expect(record).toMatchObject({
      due_date: "2026-11-01",
      state: { is: "finished", at: "2026-11-15T09:00:00.000Z" },
    });
  });
});

describe("reopen_project", () => {
  test("brings a Project back to open, and the Tasks dropped with it stay Dropped", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context);
    const task = await aTaskIn(context, project);
    value(await context.call(hand, "finish_project", { id: project.id }));
    context.advance(DAY);

    const result = value(await context.call(connection, "reopen_project", { id: project.id }));

    const dropped = { ...task, state: { is: "dropped", at: "2026-11-15T09:00:00.000Z" } };
    expect(result.record).toEqual({ ...project, tasks: [dropped] });
    expect(result.effects).toEqual([
      { kind: "project", id: project.id, what: "changed", summary: project.name, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_task", { id: task.id }))).toEqual(dropped);
  });

  test("reopening an open Project changes nothing, and one not here is not found", async () => {
    const context = newContext();
    const project = await aProject(context);

    expect(value(await context.call(hand, "reopen_project", { id: project.id }))).toEqual({
      record: project,
      effects: [],
      changed: false,
    });
    const result = await context.call(hand, "reopen_project", { id: "no-such-project" });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("a reopened Project can be declared at an end again, with the new time", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = await aProject(context);
    value(await context.call(hand, "drop_project", { id: project.id }));
    value(await context.call(hand, "reopen_project", { id: project.id }));
    context.advance(DAY);

    const { record } = value(await context.call(hand, "finish_project", { id: project.id }));

    expect(record.state).toEqual({ is: "finished", at: "2026-11-16T09:00:00.000Z" });
  });
});

describe("make_project_from_task", () => {
  test("makes a Project named after the Task, with the Task its first, in one call", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const title = marked("Plan the wedding");
    const { record: entry } = value(
      await context.call(hand, "record_entry", { words: marked("Engaged!"), tasks: [{ title }] }),
    );
    const task = entry.tasks[0] as Task;
    context.advance(60_000);

    const result = value(await context.call(agent, "make_project_from_task", { id: task.id }));

    const project = result.record;
    const kept = { ...task, project: project.id };
    expect(project).toEqual({
      id: expect.any(String),
      name: title,
      at: "2026-11-15T09:01:00.000Z",
      due_date: null,
      state: open,
      tasks: [kept],
    });
    expect(result.effects).toEqual([
      { kind: "project", id: project.id, what: "made", summary: title, by: "call" },
      { kind: "task", id: task.id, what: "changed", summary: title, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).tasks).toEqual([kept]);
    expect(value(await context.call(hand, "get_project", { id: project.id }))).toEqual(project);
  });

  test("the Project can be given a name of its own, and the Task keeps its title", async () => {
    const context = newContext();
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Kitchen"),
        tasks: [{ title: marked("Redo the kitchen") }],
      }),
    );
    const task = entry.tasks[0] as Task;
    const name = marked("Kitchen");

    const { record } = value(
      await context.call(connection, "make_project_from_task", { id: task.id, name }),
    );

    expect(record.name).toBe(name);
    expect(record.tasks).toEqual([{ ...task, project: record.id }]);
  });

  test("a Task in a Project leaves it for the new one, since a Project holds no Project", async () => {
    const context = newContext();
    const house = await aProject(context);
    const task = await aTaskIn(context, house);

    const { record } = value(await context.call(hand, "make_project_from_task", { id: task.id }));

    expect(record.tasks).toEqual([{ ...task, project: record.id }]);
    expect(value(await context.call(hand, "get_project", { id: house.id })).tasks).toEqual([]);
  });

  test("a Task not in this Context is not found, and a name is one line", async () => {
    const context = newContext();
    const elsewhere = newContext();
    const theirs = await aTaskIn(elsewhere, await aProject(elsewhere));

    for (const id of [theirs.id, "no-such-task"]) {
      const result = await context.call(hand, "make_project_from_task", { id });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Entry"),
        tasks: [{ title: marked("Task") }],
      }),
    );
    for (const name of [" ", marked("Two\nlines")]) {
      const result = await context.call(hand, "make_project_from_task", {
        id: entry.tasks[0]?.id,
        name,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "list_projects", {})).items).toEqual([]);
  });
});

describe("list_projects", () => {
  test("lists every Project newest first, with its Tasks, to every caller", async () => {
    const context = newContext();
    const older = await aProject(context, marked("Older"));
    const task = await aTaskIn(context, older);
    const newer = await aProject(context, marked("Newer"));

    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "list_projects", {}))).toEqual({
        items: [newer, { ...older, tasks: [task] }],
        next_cursor: null,
      });
    }
  });

  test("narrows to the open, Finished or Dropped ones, a reopened one being open", async () => {
    const context = newContext();
    const [stillOpen, finished, dropped, reopened] = [
      await aProject(context, marked("Open")),
      await aProject(context, marked("Finished")),
      await aProject(context, marked("Dropped")),
      await aProject(context, marked("Reopened")),
    ];
    value(await context.call(hand, "finish_project", { id: finished.id }));
    value(await context.call(hand, "drop_project", { id: dropped.id }));
    value(await context.call(hand, "drop_project", { id: reopened.id }));
    value(await context.call(hand, "reopen_project", { id: reopened.id }));

    const ids = async (state: string) =>
      value(await context.call(agent, "list_projects", { state })).items.map((each) => each.id);

    expect(await ids("open")).toEqual([reopened.id, stillOpen.id]);
    expect(await ids("finished")).toEqual([finished.id]);
    expect(await ids("dropped")).toEqual([dropped.id]);
    const result = await context.call(agent, "list_projects", { state: "overdue" });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("can be narrowed to the Projects whose name holds what was typed, whatever its case and accents", async () => {
    const context = newContext();
    const cafe = await aProject(context, marked("Café renovation"));
    await aProject(context, marked("Garden"));
    const cafes = await aProject(context, marked("New CAFES"));
    value(await context.call(hand, "finish_project", { id: cafes.id }));

    const named = async (input: object) =>
      value(await context.call(connection, "list_projects", input)).items.map((each) => each.id);

    expect(await named({ named: "cafe" })).toEqual([cafes.id, cafe.id]);
    expect(await named({ named: "cafe", state: "open" })).toEqual([cafe.id]);
  });

  test("pages by cursor, 50 to a page, and refuses a cursor it did not give", async () => {
    const context = newContext();
    const made = [];
    for (let i = 0; i < 51; i++) made.push((await aProject(context, `Project ${i}`)).id);

    const first = value(await context.call(hand, "list_projects", {}));
    const second = value(
      await context.call(hand, "list_projects", { cursor: first.next_cursor as string }),
    );

    expect(first.items).toHaveLength(50);
    expect([...first.items, ...second.items].map((each) => each.id)).toEqual(made.toReversed());
    expect(second.next_cursor).toBeNull();
    for (const cursor of ["not-a-cursor", btoa(JSON.stringify(["changes", 3]))]) {
      const result = await context.call(hand, "list_projects", { cursor });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });
});
