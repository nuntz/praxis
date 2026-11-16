import type { Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, everyCaller, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** An open Task with no dates: nothing holds for it but that the person could act on it. */
const actionable = { is: "open", actionable: true, deferred: null, overdue: null };

describe("record_entry's Tasks", () => {
  test("each Task given is made with the Entry as its Origin Entry, open, and read with it", async () => {
    const context = newContext("2026-11-15T09:30:00.000Z");
    const words = marked("Called the landlord.\n[] Send the lease");
    const [send, boiler] = [marked("Send the lease"), marked("Ask about the boiler")];

    const result = value(
      await context.call(hand, "record_entry", {
        words,
        tasks: [{ title: send }, { title: boiler }],
      }),
    );

    const entry = result.record;
    const open = (id: string, title: string) => ({
      id,
      title,
      origin_entry: entry.id,
      at: "2026-11-15T09:30:00.000Z",
      author: { kind: "person" },
      project: null,
      due_date: null,
      defer_date: null,
      state: actionable,
    });
    expect(entry.words).toBe(words);
    expect(entry.tasks).toEqual([open(expect.any(String), send), open(expect.any(String), boiler)]);
    const [first, second] = entry.tasks.map((task) => task.id);
    expect(result.effects).toEqual([
      expect.objectContaining({ kind: "entry", id: entry.id, what: "made" }),
      { kind: "task", id: first, what: "made", summary: send, by: "call" },
      { kind: "task", id: second, what: "made", summary: boiler, by: "call" },
    ]);
    expect(value(await context.call(connection, "get_entry", { id: entry.id }))).toEqual(entry);
    expect(value(await context.call(agent, "list_entries", {})).items).toEqual([entry]);
  });

  test("the words are never read to find Tasks: only the list given makes them", async () => {
    const context = newContext();

    const markedOnly = value(
      await context.call(hand, "record_entry", {
        words: marked("[] Looks like a Task\n- [ ] So does this"),
      }),
    );
    const listOnly = value(
      await context.call(agent, "record_entry", {
        words: marked("No marker here"),
        tasks: [{ title: marked("Made all the same") }],
      }),
    );

    expect(markedOnly.record.tasks).toEqual([]);
    expect(markedOnly.effects).toHaveLength(1);
    expect(listOnly.record.tasks).toEqual([expect.objectContaining({ author: { kind: "agent" } })]);
  });

  test("a Task is stamped with the Entry's Author", async () => {
    const context = newContext();

    const { record } = value(
      await context.call(connection, "record_entry", {
        words: marked("From outside"),
        tasks: [{ title: marked("Theirs") }],
      }),
    );

    expect(record.tasks[0]?.author).toEqual({ kind: "connection", name: "Claude Code" });
  });

  test("a Task needs a title of one line, and has no body", async () => {
    const context = newContext();

    for (const tasks of [
      [{ title: " \t" }],
      [{ title: marked("Two\nlines") }],
      [{ title: marked("Carriage\rreturn") }],
      [{ title: marked("Titled"), body: marked("No body") }],
      [{ title: marked("Mine"), author: { kind: "agent" } }],
      [{}],
    ]) {
      const result = await context.call(hand, "record_entry", { words: marked("Entry"), tasks });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual([]);
  });

  test("a title is kept exactly as given", async () => {
    const context = newContext();
    const title = `  ${marked("Pay [the] rent 🙃")}  `;

    const { record } = value(
      await context.call(hand, "record_entry", { words: marked("Entry"), tasks: [{ title }] }),
    );

    expect(record.tasks[0]?.title).toBe(title);
  });
});

describe("add_task", () => {
  test("attaches a Task to an Entry that exists, by its caller, after the Tasks it has", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Lease"),
        tasks: [{ title: marked("Read it") }],
      }),
    );
    context.advance(60_000);
    const title = marked("Sign it");

    const result = value(await context.call(agent, "add_task", { entry_id: entry.id, title }));

    expect(result.record).toEqual({
      id: expect.any(String),
      title,
      origin_entry: entry.id,
      at: "2026-11-15T09:01:00.000Z",
      author: { kind: "agent" },
      project: null,
      due_date: null,
      defer_date: null,
      state: actionable,
    });
    expect(result.effects).toEqual([
      { kind: "task", id: result.record.id, what: "made", summary: title, by: "call" },
    ]);
    const read = value(await context.call(hand, "get_entry", { id: entry.id }));
    expect(read.words).toBe(entry.words);
    expect(read.tasks).toEqual([...entry.tasks, result.record]);
  });

  test("needs an Entry in this Context: there is no Task without one", async () => {
    const context = newContext();
    const elsewhere = newContext();
    const { record } = value(
      await elsewhere.call(hand, "record_entry", { words: marked("Elsewhere") }),
    );

    for (const entry_id of [record.id, "no-such-entry"]) {
      const result = await context.call(hand, "add_task", { entry_id, title: marked("Orphan") });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    for (const input of [{ title: marked("No Entry named") }, { entry_id: record.id }]) {
      const result = await elsewhere.call(hand, "add_task", input);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });

  test("a title is one line with words in it", async () => {
    const context = newContext();
    const { record } = value(await context.call(hand, "record_entry", { words: marked("Entry") }));

    for (const title of ["", "  ", marked("One\nTwo")]) {
      const result = await context.call(hand, "add_task", { entry_id: record.id, title });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });
});

/** An Entry the person recorded with one Task, and that Task. */
async function aTask(context: Context) {
  const title = marked("Send the lease");
  const { record: entry } = value(
    await context.call(hand, "record_entry", { words: marked("Lease"), tasks: [{ title }] }),
  );
  return { entry, task: entry.tasks[0] as Task };
}

describe("finish_task", () => {
  test("a Task reaches Finished, with when, and is read so with its Entry", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { entry, task } = await aTask(context);
    context.advance(DAY);

    const result = value(await context.call(connection, "finish_task", { id: task.id }));

    const finished = { ...task, state: { is: "finished", at: "2026-11-16T09:00:00.000Z" } };
    expect(result.record).toEqual(finished);
    expect(result.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).tasks).toEqual([
      finished,
    ]);
  });

  test("finishing a Finished Task asks for what is already so: nothing changes", async () => {
    const context = newContext();
    const { task } = await aTask(context);
    const first = value(await context.call(hand, "finish_task", { id: task.id }));
    context.advance(DAY);

    const again = value(await context.call(agent, "finish_task", { id: task.id }));

    expect(again).toEqual({ record: first.record, effects: [], changed: false });
  });

  test("a Task that is not in this Context is not found", async () => {
    const context = newContext();
    const { task } = await aTask(newContext());

    for (const id of [task.id, "no-such-task"]) {
      const result = await context.call(hand, "finish_task", { id });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });
});

describe("drop_task", () => {
  test("a Task reaches Dropped, with when, and stays with its Entry", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { entry, task } = await aTask(context);
    context.advance(60_000);

    const result = value(await context.call(agent, "drop_task", { id: task.id }));

    const dropped = { ...task, state: { is: "dropped", at: "2026-11-15T09:01:00.000Z" } };
    expect(result.record).toEqual(dropped);
    expect(result.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).tasks).toEqual([dropped]);
  });

  test("dropping a Dropped Task changes nothing", async () => {
    const context = newContext();
    const { task } = await aTask(context);
    const first = value(await context.call(hand, "drop_task", { id: task.id }));
    context.advance(DAY);

    expect(value(await context.call(hand, "drop_task", { id: task.id }))).toEqual({
      record: first.record,
      effects: [],
      changed: false,
    });
  });

  test("a Task not in this Context is not found", async () => {
    const result = await newContext().call(hand, "drop_task", { id: "no-such-task" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("a Task at one end", () => {
  test("is refused the other end until it is reopened, and the refusal names it", async () => {
    const context = newContext();
    const finished = (await aTask(context)).task;
    const dropped = (await aTask(context)).task;
    value(await context.call(hand, "finish_task", { id: finished.id }));
    value(await context.call(hand, "drop_task", { id: dropped.id }));

    for (const [tool, task] of [
      ["drop_task", finished],
      ["finish_task", dropped],
    ] as const) {
      const result = await context.call(hand, tool, { id: task.id });
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
});

describe("reopen_task", () => {
  test("brings a Task back from either end to open", async () => {
    const context = newContext();
    const { entry, task: finished } = await aTask(context);
    const { task: dropped } = await aTask(context);
    value(await context.call(hand, "finish_task", { id: finished.id }));
    value(await context.call(hand, "drop_task", { id: dropped.id }));

    for (const task of [finished, dropped]) {
      const result = value(await context.call(connection, "reopen_task", { id: task.id }));
      expect(result.record).toEqual(task);
      expect(result.effects).toEqual([
        { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
      ]);
    }
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).tasks).toEqual([
      finished,
    ]);
  });

  test("reopening an open Task changes nothing", async () => {
    const context = newContext();
    const { task } = await aTask(context);

    expect(value(await context.call(hand, "reopen_task", { id: task.id }))).toEqual({
      record: task,
      effects: [],
      changed: false,
    });
  });

  test("a reopened Task reaches an end again, with the new time", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { task } = await aTask(context);
    value(await context.call(hand, "finish_task", { id: task.id }));
    value(await context.call(hand, "reopen_task", { id: task.id }));
    context.advance(DAY);

    const { record } = value(await context.call(hand, "drop_task", { id: task.id }));

    expect(record.state).toEqual({ is: "dropped", at: "2026-11-16T09:00:00.000Z" });
  });

  test("a Task not in this Context is not found", async () => {
    const result = await newContext().call(hand, "reopen_task", { id: "no-such-task" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("rename_task", () => {
  test("changes a Task's title and nothing else, open or closed", async () => {
    const context = newContext();
    const { entry, task } = await aTask(context);
    const { record: finished } = value(await context.call(hand, "finish_task", { id: task.id }));
    const title = marked("Send the signed lease");

    const result = value(await context.call(agent, "rename_task", { id: task.id, title }));

    expect(result.record).toEqual({ ...finished, title });
    expect(result.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: title, by: "call" },
    ]);
    const read = value(await context.call(hand, "get_entry", { id: entry.id }));
    expect(read).toEqual({ ...entry, tasks: [{ ...finished, title }] });
  });

  test("a Task the person renames becomes theirs, and one the Agent renames keeps its Author", async () => {
    const context = newContext();
    const { record: entry } = value(
      await context.call(connection, "record_entry", {
        words: marked("From outside"),
        tasks: [{ title: marked("Theirs") }, { title: marked("Still theirs") }],
      }),
    );
    const [renamed, kept] = entry.tasks as [Task, Task];

    const byHand = value(
      await context.call(hand, "rename_task", { id: renamed.id, title: marked("Mine now") }),
    );
    const byAgent = value(
      await context.call(agent, "rename_task", { id: kept.id, title: marked("Retitled") }),
    );

    expect(byHand.record.author).toEqual({ kind: "person" });
    expect(byAgent.record.author).toEqual(kept.author);
  });

  test("renaming a Task to the title it has changes nothing", async () => {
    const context = newContext();
    const { task } = await aTask(context);

    expect(
      value(await context.call(hand, "rename_task", { id: task.id, title: task.title })),
    ).toEqual({ record: task, effects: [], changed: false });
  });

  test("a title is one line with words in it", async () => {
    const context = newContext();
    const { task } = await aTask(context);

    for (const title of [" ", marked("One\r\nTwo")]) {
      const result = await context.call(hand, "rename_task", { id: task.id, title });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });

  test("a Task not in this Context is not found", async () => {
    const result = await newContext().call(hand, "rename_task", {
      id: "no-such-task",
      title: marked("Renamed"),
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("set_task_dates", () => {
  test("sets a Due Date and a Defer Date, read with the Task and the day each state holds from", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { entry, task } = await aTask(context);

    const result = value(
      await context.call(connection, "set_task_dates", {
        id: task.id,
        due_date: "2026-11-10",
        defer_date: "2026-11-18",
      }),
    );

    const dated = {
      ...task,
      due_date: "2026-11-10",
      defer_date: "2026-11-18",
      state: {
        is: "open",
        actionable: false,
        deferred: { until: "2026-11-18" },
        overdue: { since: "2026-11-11" },
      },
    };
    expect(result.record).toEqual(dated);
    expect(result.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
    expect(value(await context.call(agent, "get_task", { id: task.id }))).toEqual(dated);
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).tasks).toEqual([dated]);
  });

  test("leaves a date it is not given as it was, and clears one given as null", async () => {
    const context = newContext();
    const { task } = await aTask(context);
    const set = (dates: object) =>
      context.call(agent, "set_task_dates", { id: task.id, ...dates }).then(value);

    const due = await set({ due_date: "2026-12-01" });
    const both = await set({ defer_date: "2026-11-20" });
    const cleared = await set({ due_date: null });

    expect([due, both, cleared].map(({ record }) => [record.due_date, record.defer_date])).toEqual([
      ["2026-12-01", null],
      ["2026-12-01", "2026-11-20"],
      [null, "2026-11-20"],
    ]);
  });

  test("dates the Task already has change nothing", async () => {
    const context = newContext();
    const { task } = await aTask(context);
    const first = value(
      await context.call(hand, "set_task_dates", { id: task.id, due_date: "2026-12-01" }),
    );

    for (const dates of [{ due_date: "2026-12-01" }, { defer_date: null }]) {
      const again = value(await context.call(hand, "set_task_dates", { id: task.id, ...dates }));
      expect(again).toEqual({ record: first.record, effects: [], changed: false });
    }
  });

  test("Overdue and Deferred are judged by today in the Context's time zone", async () => {
    // Noon on the 15th in London is already the 16th in Auckland.
    const at = "2026-11-15T12:00:00.000Z";
    const dates = { due_date: "2026-11-15", defer_date: "2026-11-16" };
    const states = [];
    for (const time_zone of ["Europe/London", "Pacific/Auckland"]) {
      const context = newContext(at, { name: "Work", time_zone });
      const { task } = await aTask(context);
      states.push(
        value(await context.call(hand, "set_task_dates", { id: task.id, ...dates })).record.state,
      );
    }

    expect(states).toEqual([
      { is: "open", actionable: false, deferred: { until: "2026-11-16" }, overdue: null },
      { is: "open", actionable: true, deferred: null, overdue: { since: "2026-11-16" } },
    ]);
  });

  test("a closed Task keeps its dates and is neither Overdue nor Deferred", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { task } = await aTask(context);
    value(await context.call(hand, "finish_task", { id: task.id }));

    const { record } = value(
      await context.call(hand, "set_task_dates", {
        id: task.id,
        due_date: "2026-11-01",
        defer_date: "2026-12-01",
      }),
    );

    expect(record).toMatchObject({
      due_date: "2026-11-01",
      defer_date: "2026-12-01",
      state: { is: "finished", at: "2026-11-15T09:00:00.000Z" },
    });
  });

  test("dates are days, never prose or a time of day, and at least one is given", async () => {
    const context = newContext();
    const { task } = await aTask(context);

    for (const dates of [
      { due_date: "next Friday" },
      { due_date: "2026-02-29" },
      { defer_date: "2026-11-20T09:00:00Z" },
      { defer_date: "20/11/2026" },
      { due_date: 20261120 },
      {},
    ]) {
      const result = await context.call(hand, "set_task_dates", { id: task.id, ...dates });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });

  test("setting dates leaves the Task's Author as it was", async () => {
    const context = newContext();
    const { record: entry } = value(
      await context.call(connection, "record_entry", {
        words: marked("From outside"),
        tasks: [{ title: marked("Theirs") }],
      }),
    );
    const task = entry.tasks[0] as Task;

    const { record } = value(
      await context.call(hand, "set_task_dates", { id: task.id, due_date: "2026-12-01" }),
    );

    expect(record.author).toEqual(task.author);
  });

  test("a Task not in this Context is not found", async () => {
    const result = await newContext().call(hand, "set_task_dates", {
      id: "no-such-task",
      due_date: "2026-12-01",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("get_task", () => {
  test("reads one Task with its derived state, by every caller", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const { task } = await aTask(context);
    value(await context.call(hand, "drop_task", { id: task.id }));

    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "get_task", { id: task.id }))).toEqual({
        ...task,
        state: { is: "dropped", at: "2026-11-15T09:00:00.000Z" },
      });
    }
  });

  test("a Task not in this Context is not found", async () => {
    const context = newContext();
    const { task } = await aTask(newContext());

    const result = await context.call(hand, "get_task", { id: task.id });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("list_tasks", () => {
  test("lists every Task in the Context newest first, whatever its Entry or state, to every caller", async () => {
    const context = newContext();
    const first = await aTask(context);
    const second = await aTask(context);
    const dropped = value(await context.call(hand, "drop_task", { id: first.task.id })).record;

    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "list_tasks", {}))).toEqual({
        items: [second.task, dropped],
        next_cursor: null,
      });
    }
  });

  test("can be narrowed to the Tasks whose title holds what was typed, whatever its case and accents", async () => {
    const context = newContext();
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("Plans"),
        tasks: [
          { title: marked("Résumé the lease") },
          { title: marked("Buy paint") },
          { title: marked("Send the RESUME") },
        ],
      }),
    ).record;
    const [resume, , sendResume] = entry.tasks;

    const { items } = value(await context.call(agent, "list_tasks", { named: "resume" }));

    expect(items).toEqual([sendResume, resume]);
  });

  test("pages by cursor, 50 to a page, and refuses a cursor it did not give", async () => {
    const context = newContext();
    const titles = Array.from({ length: 51 }, (_, i) => ({ title: `Task ${i}` }));
    const { tasks } = value(
      await context.call(hand, "record_entry", { words: marked("Many"), tasks: titles }),
    ).record;

    const first = value(await context.call(hand, "list_tasks", {}));
    const second = value(
      await context.call(hand, "list_tasks", { cursor: first.next_cursor as string }),
    );

    expect(first.items).toHaveLength(50);
    expect([...first.items, ...second.items]).toEqual(tasks.toReversed());
    expect(second.next_cursor).toBeNull();
    for (const cursor of ["not-a-cursor", btoa(JSON.stringify(["projects", 3]))]) {
      const result = await context.call(hand, "list_tasks", { cursor });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });
});

describe("a bare create_task", () => {
  test("does not exist: a Task is made only with an Entry named", async () => {
    const result = await newContext().callAny(hand, "create_task", { title: marked("Bare") });

    expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
  });
});
