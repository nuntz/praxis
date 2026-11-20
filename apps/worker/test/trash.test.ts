import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, everyCaller, hand, newContext, value } from "./seam.ts";

// Deleting and the Trash (section 3.8, ADR 0014): a delete sends to the Trash the record and only
// what cannot exist without it, is never refused for what hangs off it, and comes back together.

type Context = ReturnType<typeof newContext>;

/** An Entry recorded by the person, with these Tasks made with it. */
async function anEntry(context: Context, words = marked("Plans"), titles: string[] = []) {
  return value(
    await context.call(hand, "record_entry", {
      words,
      tasks: titles.map((title) => ({ title })),
    }),
  ).record;
}

describe("delete_entry", () => {
  test("takes the Tasks it is the Origin Entry of, open or closed, with every Occurrence", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [words, open, done, waiter] = [
      marked("House"),
      marked("Paint"),
      marked("Sand"),
      marked("Hang the door"),
    ];
    const entry = await anEntry(context, words, [open, done]);
    const [paint, sand] = entry.tasks;
    const other = await anEntry(context, marked("Doors"), [waiter]);
    const hang = other.tasks[0];
    value(
      await context.call(hand, "wait_on", { id: hang?.id, on: { kind: "task", id: paint?.id } }),
    );
    value(await context.call(hand, "set_task_dates", { id: sand?.id, due_date: "2026-11-20" }));
    value(
      await context.call(hand, "set_recurrence", {
        id: sand?.id,
        recurrence: { kind: "interval", every: 1, unit: "weeks" },
      }),
    );
    const next = value(await context.call(hand, "finish_task", { id: sand?.id })).effects[1];

    const result = value(await context.call(hand, "delete_entry", { id: entry.id }));

    expect(result.record).toEqual({
      record: { kind: "entry", id: entry.id, summary: words },
      went_with: [
        { kind: "task", id: paint?.id, summary: open },
        { kind: "task", id: sand?.id, summary: done },
        { kind: "task", id: next?.id, summary: done },
      ],
      deleted_at: "2026-11-15T09:00:00.000Z",
      removed_at: "2026-12-15T09:00:00.000Z",
    });
    expect(result.effects).toEqual([
      { kind: "entry", id: entry.id, what: "deleted", summary: words, by: "call" },
      { kind: "task", id: paint?.id, what: "deleted", summary: open, by: "rule" },
      { kind: "task", id: sand?.id, what: "deleted", summary: done, by: "rule" },
      { kind: "task", id: next?.id, what: "deleted", summary: done, by: "rule" },
      { kind: "task", id: hang?.id, what: "changed", summary: waiter, by: "rule" },
    ]);
    for (const [tool, id] of [
      ["get_entry", entry.id],
      ["get_task", paint?.id],
      ["get_task", next?.id],
      ["list_entry_versions", entry.id],
    ] as const) {
      expect(await context.call(hand, tool, { id })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
    expect(value(await context.call(hand, "list_entries", {})).items.map((e) => e.id)).toEqual([
      other.id,
    ]);
    const view = value(await context.call(hand, "view_attention", {}));
    // Its wait ended, so it came up.
    expect(view.newly_actionable).toEqual([
      expect.objectContaining({ task: expect.objectContaining({ id: hang?.id }) }),
    ]);
  });

  test("every other link to it is kept dormant: shown as deleted, no Effect, and no words change", async () => {
    const context = newContext();
    const [title, name] = [marked("Paint"), marked("Ali")];
    const entry = await anEntry(context, marked("House"), [title]);
    const paint = entry.tasks[0];
    const ali = value(await context.call(hand, "create_person", { name })).record;
    const words = marked("About the paint");
    const linking = value(
      await context.call(hand, "record_entry", {
        words,
        links: [{ to: { kind: "task", id: paint?.id } }, { to: { kind: "person", id: ali.id } }],
        follow_up_to: entry.id,
      }),
    ).record;

    const result = value(await context.call(hand, "delete_entry", { id: entry.id }));

    expect(result.effects.map(({ id }) => id)).toEqual([entry.id, paint?.id]);
    const after = value(await context.call(hand, "get_entry", { id: linking.id }));
    expect(after.words).toBe(words);
    expect(after.links).toEqual([
      {
        kind: "reference",
        to: { kind: "task", id: paint?.id, summary: title, deleted: true },
        anchor: null,
      },
      { kind: "mention", to: { kind: "person", id: ali.id, summary: name }, anchor: null },
    ]);
    expect(after.follow_up_to).toEqual({
      id: entry.id,
      summary: expect.any(String),
      deleted: true,
    });

    value(await context.call(hand, "restore", { id: entry.id }));

    expect(value(await context.call(hand, "get_entry", { id: linking.id }))).toEqual(linking);
  });

  test("a Follow-up in the Trash is not among the Follow-ups of the Entry it continues", async () => {
    const context = newContext();
    const entry = await anEntry(context);
    const followUp = value(
      await context.call(hand, "record_entry", { words: marked("Later"), follow_up_to: entry.id }),
    ).record;

    value(await context.call(hand, "delete_entry", { id: followUp.id }));

    expect(value(await context.call(hand, "get_entry", { id: entry.id })).follow_ups).toEqual([]);
  });

  test("an Entry linking to what is in the Trash is recorded with that link dormant", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint")]);
    const paint = entry.tasks[0];
    value(await context.call(hand, "delete_entry", { id: entry.id }));

    const recorded = value(
      await context.call(hand, "record_entry", {
        words: marked("About the paint"),
        links: [{ to: { kind: "task", id: paint?.id } }],
        follow_up_to: entry.id,
      }),
    ).record;

    expect(recorded.links).toEqual([
      {
        kind: "reference",
        to: expect.objectContaining({ id: paint?.id, deleted: true }),
        anchor: null,
      },
    ]);
    expect(recorded.follow_up_to).toMatchObject({ id: entry.id, deleted: true });
  });

  test("the Agent's delete of the person's Entry leaves a Held Change, and a Connection's is refused", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint")]);

    expect(await context.call(agent, "delete_entry", { id: entry.id })).toMatchObject({
      ok: true,
      value: { held: true, record: { tool: "delete_entry", entry: { id: entry.id } } },
    });
    expect(await context.call(connection, "delete_entry", { id: entry.id })).toMatchObject({
      ok: false,
      error: { code: "held" },
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
  });

  test("the Agent deletes an Entry it is the Author of at once", async () => {
    const context = newContext();
    const entry = value(
      await context.call(agent, "record_entry", { words: marked("Notes") }),
    ).record;

    const result = value(await context.call(agent, "delete_entry", { id: entry.id }));

    expect(result.effects.map(({ id, what }) => [id, what])).toEqual([[entry.id, "deleted"]]);
  });
});

describe("delete_task", () => {
  test("sends a Task to the Trash, where it reads as not found by every caller and list_trash shows it", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const title = marked("Call the plumber");
    const entry = await anEntry(context, marked("House"), [title]);
    const task = entry.tasks[0];

    const result = value(await context.call(agent, "delete_task", { id: task?.id }));

    const item = {
      record: { kind: "task", id: task?.id, summary: title },
      went_with: [],
      deleted_at: "2026-11-15T09:00:00.000Z",
      removed_at: "2026-12-15T09:00:00.000Z",
    };
    expect(result.record).toEqual(item);
    expect(result.effects).toEqual([
      { kind: "task", id: task?.id, what: "deleted", summary: title, by: "call" },
    ]);
    for (const caller of everyCaller) {
      expect(await context.call(caller, "get_task", { id: task?.id })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
      expect(value(await context.call(caller, "list_trash", {}))).toEqual({
        items: [item],
        next_cursor: null,
      });
    }
    // Its Origin Entry is never touched, and no longer shows it.
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).tasks).toEqual([]);
    expect(value(await context.call(hand, "list_tasks", {})).items).toEqual([]);
  });

  test("each Task waiting on it stops waiting, by rule, and an earlier Occurrence stays", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [waiter, waited] = [marked("Paint"), marked("Buy paint")];
    const entry = await anEntry(context, marked("House"), [waiter, waited]);
    const [paint, buy] = entry.tasks;
    value(
      await context.call(hand, "wait_on", { id: paint?.id, on: { kind: "task", id: buy?.id } }),
    );
    value(await context.call(hand, "set_task_dates", { id: buy?.id, due_date: "2026-11-20" }));
    value(
      await context.call(hand, "set_recurrence", {
        id: buy?.id,
        recurrence: { kind: "interval", every: 1, unit: "weeks" },
      }),
    );
    const next = value(await context.call(hand, "finish_task", { id: buy?.id })).effects.find(
      (effect) => effect.what === "made",
    );
    value(
      await context.call(hand, "wait_on", { id: paint?.id, on: { kind: "task", id: next?.id } }),
    );

    // Deleting the open Occurrence takes its Recurrence, and makes no next one.
    const result = value(await context.call(connection, "delete_task", { id: next?.id }));

    expect(result.effects).toEqual([
      { kind: "task", id: next?.id, what: "deleted", summary: waited, by: "call" },
      { kind: "task", id: paint?.id, what: "changed", summary: waiter, by: "rule" },
    ]);
    const after = value(await context.call(hand, "get_task", { id: paint?.id }));
    expect(after.state).toMatchObject({ is: "open", actionable: true, waiting: null });
    expect(value(await context.call(hand, "get_task", { id: buy?.id })).state.is).toBe("finished");
  });

  test("a Task in the Trash cannot be changed, deleted again or linked to", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Call the plumber")]);
    const task = entry.tasks[0];
    value(await context.call(hand, "delete_task", { id: task?.id }));

    for (const [tool, input] of [
      ["finish_task", { id: task?.id }],
      ["rename_task", { id: task?.id, title: marked("Renamed") }],
      ["delete_task", { id: task?.id }],
      ["add_link", { entry_id: entry.id, to: { kind: "task", id: task?.id } }],
    ] as const) {
      expect(await context.call(connection, tool, input)).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });
});

describe("delete_project", () => {
  test("takes nothing: its Tasks stay and show no Project, and Tasks waiting on it stop waiting", async () => {
    const context = newContext();
    const [name, inIt, waiter] = [marked("Kitchen"), marked("Tile"), marked("Cook")];
    const project = value(await context.call(hand, "create_project", { name })).record;
    const entry = await anEntry(context, marked("House"), [inIt, waiter]);
    const [tile, cook] = entry.tasks;
    value(await context.call(hand, "move_task", { id: tile?.id, project_id: project.id }));
    value(
      await context.call(hand, "wait_on", {
        id: cook?.id,
        on: { kind: "project", id: project.id },
      }),
    );

    const result = value(await context.call(agent, "delete_project", { id: project.id }));

    expect(result.record.went_with).toEqual([]);
    expect(result.effects).toEqual([
      { kind: "project", id: project.id, what: "deleted", summary: name, by: "call" },
      { kind: "task", id: tile?.id, what: "changed", summary: inIt, by: "rule" },
      { kind: "task", id: cook?.id, what: "changed", summary: waiter, by: "rule" },
    ]);
    expect(value(await context.call(hand, "get_task", { id: tile?.id })).project).toBeNull();
    expect(value(await context.call(hand, "get_task", { id: cook?.id })).state).toMatchObject({
      waiting: null,
    });
    expect(value(await context.call(hand, "list_projects", {})).items).toEqual([]);
    expect(value(await context.call(hand, "view_attention", {})).projects).toEqual([]);
  });

  test("on restore its Tasks come back to it, unless moved to another Project since", async () => {
    const context = newContext();
    const project = value(
      await context.call(hand, "create_project", { name: marked("Kitchen") }),
    ).record;
    const other = value(
      await context.call(hand, "create_project", { name: marked("Garden") }),
    ).record;
    const entry = await anEntry(context, marked("House"), [marked("Tile"), marked("Paint")]);
    const [tile, paint] = entry.tasks;
    for (const task of [tile, paint]) {
      value(await context.call(hand, "move_task", { id: task?.id, project_id: project.id }));
    }
    value(await context.call(hand, "delete_project", { id: project.id }));
    value(await context.call(hand, "move_task", { id: paint?.id, project_id: other.id }));

    const result = value(await context.call(hand, "restore", { id: project.id }));

    expect(result.effects.map(({ id, what }) => [id, what])).toEqual([
      [project.id, "made"],
      [tile?.id, "changed"],
    ]);
    expect(value(await context.call(hand, "get_task", { id: tile?.id })).project).toBe(project.id);
    expect(value(await context.call(hand, "get_task", { id: paint?.id })).project).toBe(other.id);
  });
});

describe("delete_person", () => {
  test("takes nothing: each open Task Delegated to them is taken back, and Mentions stay dormant", async () => {
    const context = newContext();
    const [name, title] = [marked("Ali"), marked("Quote")];
    const ali = value(await context.call(hand, "create_person", { name })).record;
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("Ask Ali"),
        tasks: [{ title }, { title: marked("Done") }],
        links: [{ to: { kind: "person", id: ali.id } }],
      }),
    ).record;
    const [quote, done] = entry.tasks;
    for (const task of [quote, done]) {
      value(await context.call(hand, "delegate_task", { id: task?.id, person_id: ali.id }));
    }
    value(await context.call(hand, "finish_task", { id: done?.id }));

    const result = value(await context.call(connection, "delete_person", { id: ali.id }));

    expect(result.effects).toEqual([
      { kind: "person", id: ali.id, what: "deleted", summary: name, by: "call" },
      { kind: "task", id: quote?.id, what: "changed", summary: title, by: "rule" },
    ]);
    expect(value(await context.call(hand, "get_task", { id: quote?.id })).state).toMatchObject({
      is: "open",
      delegated: null,
      actionable: true,
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id })).links).toEqual([
      {
        kind: "mention",
        to: { kind: "person", id: ali.id, summary: name, deleted: true },
        anchor: null,
      },
    ]);
    expect(await context.call(hand, "get_person", { id: ali.id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(
      await context.call(hand, "delegate_task", { id: quote?.id, person_id: ali.id }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("on restore a Task goes back to Delegated only if still open and Delegated to nobody else", async () => {
    const context = newContext();
    const ali = value(await context.call(hand, "create_person", { name: marked("Ali") })).record;
    const sam = value(await context.call(hand, "create_person", { name: marked("Sam") })).record;
    const entry = await anEntry(context, marked("Asks"), [
      marked("Back"),
      marked("Handed on"),
      marked("Finished"),
    ]);
    const [back, handedOn, finished] = entry.tasks;
    for (const task of entry.tasks) {
      value(await context.call(hand, "delegate_task", { id: task.id, person_id: ali.id }));
    }
    value(await context.call(hand, "delete_person", { id: ali.id }));
    value(await context.call(hand, "delegate_task", { id: handedOn?.id, person_id: sam.id }));
    value(await context.call(hand, "finish_task", { id: finished?.id }));

    const result = value(await context.call(hand, "restore", { id: ali.id }));

    expect(result.effects.map(({ id, what }) => [id, what])).toEqual([
      [ali.id, "made"],
      [back?.id, "changed"],
    ]);
    const delegatedTo = async (id?: string) => {
      const { state } = value(await context.call(hand, "get_task", { id }));
      return state.is === "open" ? (state.delegated?.to.id ?? null) : state.is;
    };
    expect(await delegatedTo(back?.id)).toBe(ali.id);
    expect(await delegatedTo(handedOn?.id)).toBe(sam.id);
    expect(await delegatedTo(finished?.id)).toBe("finished");
  });
});

describe("list_trash", () => {
  test("lists what is in the Trash, newest delete first, each with when it will be removed", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [first, second] = [marked("First"), marked("Second")];
    const entry = await anEntry(context, marked("House"), [first, second]);
    value(await context.call(hand, "delete_task", { id: entry.tasks[0]?.id }));
    context.advance(DAY);
    value(await context.call(hand, "delete_task", { id: entry.tasks[1]?.id }));

    const listed = value(await context.call(connection, "list_trash", {}));

    expect(listed.items.map((item) => [item.record.summary, item.removed_at])).toEqual([
      [second, "2026-12-16T09:00:00.000Z"],
      [first, "2026-12-15T09:00:00.000Z"],
    ]);
  });
});

describe("restore", () => {
  test("brings a Task back as it was, with its Recurrence, and the waits on it resume", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const [waiter, waited] = [marked("Paint"), marked("Buy paint")];
    const entry = await anEntry(context, marked("House"), [waiter, waited]);
    const [paint, buy] = entry.tasks;
    value(
      await context.call(hand, "wait_on", { id: paint?.id, on: { kind: "task", id: buy?.id } }),
    );
    value(await context.call(hand, "set_task_dates", { id: buy?.id, due_date: "2026-11-20" }));
    const recurring = value(
      await context.call(hand, "set_recurrence", {
        id: buy?.id,
        recurrence: { kind: "interval", every: 1, unit: "weeks" },
      }),
    ).record;
    const deleted = value(await context.call(hand, "delete_task", { id: buy?.id })).record;
    context.advance(DAY);

    const result = value(await context.call(agent, "restore", { id: buy?.id }));

    expect(result.record).toEqual(deleted);
    expect(result.effects).toEqual([
      { kind: "task", id: buy?.id, what: "made", summary: waited, by: "call" },
      { kind: "task", id: paint?.id, what: "changed", summary: waiter, by: "rule" },
    ]);
    expect(value(await context.call(hand, "get_task", { id: buy?.id }))).toEqual(recurring);
    const after = value(await context.call(hand, "get_task", { id: paint?.id }));
    expect(after.state).toMatchObject({
      is: "open",
      waiting: [{ on: { kind: "task", id: buy?.id, title: waited } }],
    });
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
  });

  test("a wait resumes only if the waiting Task is still open", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint"), marked("Buy paint")]);
    const [paint, buy] = entry.tasks;
    value(
      await context.call(hand, "wait_on", { id: paint?.id, on: { kind: "task", id: buy?.id } }),
    );
    value(await context.call(hand, "delete_task", { id: buy?.id }));
    value(await context.call(hand, "finish_task", { id: paint?.id }));

    const result = value(await context.call(hand, "restore", { id: buy?.id }));

    expect(result.effects.map(({ id, what }) => [id, what])).toEqual([[buy?.id, "made"]]);
    expect(value(await context.call(hand, "get_task", { id: paint?.id })).state.is).toBe(
      "finished",
    );
  });

  test("restoring a Task whose Origin Entry is in the Trash restores that Entry and all that went with it", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint"), marked("Sand")]);
    const [paint, sand] = entry.tasks;
    value(await context.call(hand, "delete_task", { id: paint?.id }));
    value(await context.call(hand, "delete_entry", { id: entry.id }));

    const result = value(await context.call(hand, "restore", { id: paint?.id }));

    expect(result.effects.map(({ id, what, by }) => [id, what, by])).toEqual([
      [paint?.id, "made", "call"],
      [entry.id, "made", "rule"],
      [sand?.id, "made", "rule"],
    ]);
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
  });

  test("a Task deleted on its own stays in the Trash when its Origin Entry is restored", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint"), marked("Sand")]);
    const [paint, sand] = entry.tasks;
    value(await context.call(hand, "delete_task", { id: paint?.id }));
    value(await context.call(hand, "delete_entry", { id: entry.id }));

    value(await context.call(hand, "restore", { id: sand?.id }));

    const back = value(await context.call(hand, "get_entry", { id: entry.id }));
    expect(back.tasks.map((task) => task.id)).toEqual([sand?.id]);
    const trash = value(await context.call(hand, "list_trash", {})).items;
    expect(trash.map((item) => item.record.id)).toEqual([paint?.id]);
  });

  test("a Task back from the Trash holds no wait on what is in the Trash now, until that comes back too", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint"), marked("Buy paint")]);
    const [paint, buy] = entry.tasks;
    value(
      await context.call(hand, "wait_on", { id: paint?.id, on: { kind: "task", id: buy?.id } }),
    );
    value(await context.call(hand, "delete_task", { id: paint?.id }));
    value(await context.call(hand, "delete_task", { id: buy?.id }));

    value(await context.call(hand, "restore", { id: paint?.id }));
    expect(value(await context.call(hand, "get_task", { id: paint?.id })).state).toMatchObject({
      waiting: null,
    });

    const result = value(await context.call(hand, "restore", { id: buy?.id }));
    expect(result.effects.map(({ id, what }) => [id, what])).toEqual([
      [buy?.id, "made"],
      [paint?.id, "changed"],
    ]);
    expect(value(await context.call(hand, "get_task", { id: paint?.id })).state).toMatchObject({
      waiting: [{ on: { id: buy?.id } }],
    });
  });

  test("a wait does not resume when it would close a cycle made while it was away", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [
      marked("Paint"),
      marked("Buy paint"),
      marked("Pick colour"),
    ]);
    const [paint, buy, pick] = entry.tasks;
    value(
      await context.call(hand, "wait_on", { id: paint?.id, on: { kind: "task", id: buy?.id } }),
    );
    value(await context.call(hand, "wait_on", { id: buy?.id, on: { kind: "task", id: pick?.id } }));
    value(await context.call(hand, "delete_task", { id: buy?.id }));
    value(
      await context.call(hand, "wait_on", { id: pick?.id, on: { kind: "task", id: paint?.id } }),
    );

    const result = value(await context.call(hand, "restore", { id: buy?.id }));

    expect(result.effects.map(({ id }) => id)).toEqual([buy?.id]);
    expect(value(await context.call(hand, "get_task", { id: paint?.id })).state).toMatchObject({
      waiting: null,
    });
  });

  test("a link whose Task is in the Trash too waits for that Task, and comes back with it", async () => {
    const context = newContext();
    const project = value(
      await context.call(hand, "create_project", { name: marked("Kitchen") }),
    ).record;
    const ali = value(await context.call(hand, "create_person", { name: marked("Ali") })).record;
    const entry = await anEntry(context, marked("House"), [marked("Tile"), marked("Grout")]);
    const [tile, grout] = entry.tasks;
    value(await context.call(hand, "move_task", { id: tile?.id, project_id: project.id }));
    value(await context.call(hand, "delegate_task", { id: tile?.id, person_id: ali.id }));
    value(
      await context.call(hand, "wait_on", { id: tile?.id, on: { kind: "task", id: grout?.id } }),
    );
    value(await context.call(hand, "delete_project", { id: project.id }));
    value(await context.call(hand, "delete_person", { id: ali.id }));
    value(await context.call(hand, "delete_task", { id: grout?.id }));
    value(await context.call(hand, "delete_task", { id: tile?.id }));
    for (const id of [project.id, ali.id, grout?.id]) {
      value(await context.call(hand, "restore", { id }));
    }

    value(await context.call(hand, "restore", { id: tile?.id }));

    const back = value(await context.call(hand, "get_task", { id: tile?.id }));
    expect(back.project).toBe(project.id);
    expect(back.state).toMatchObject({
      delegated: { to: { id: ali.id } },
      waiting: [{ on: { id: grout?.id } }],
    });
  });

  test("restoring what is not in the Trash is not found", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint")]);

    for (const id of [entry.tasks[0]?.id, entry.id, "no-such-record"]) {
      expect(await context.call(hand, "restore", { id })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });
});

describe("remove_for_good", () => {
  test("takes the item and every dormant link to it, leaves no marker, and blanks its summaries in the change log", async () => {
    const context = newContext();
    const [words, title] = [marked("House"), marked("Paint")];
    const entry = await anEntry(context, words, [title]);
    const paint = entry.tasks[0];
    value(await context.call(hand, "rename_task", { id: paint?.id, title: marked("Repaint") }));
    value(
      await context.call(hand, "edit_entry", { id: entry.id, words: marked("Houses"), version: 0 }),
    );
    const otherWords = marked("About the paint");
    const linking = value(
      await context.call(hand, "record_entry", {
        words: otherWords,
        links: [{ to: { kind: "task", id: paint?.id } }],
        follow_up_to: entry.id,
      }),
    ).record;
    value(await context.call(hand, "delete_entry", { id: entry.id }));

    const result = value(await context.call(hand, "remove_for_good", { id: paint?.id }));

    expect(result.record).toEqual({ items: 1 });
    expect(result.effects).toEqual([
      { kind: "entry", id: entry.id, what: "deleted", summary: "", by: "call" },
      { kind: "task", id: paint?.id, what: "deleted", summary: "", by: "rule" },
      { kind: "entry", id: linking.id, what: "changed", summary: otherWords, by: "rule" },
    ]);
    // A Follow-up of it becomes an ordinary Entry, and a link to what went is gone.
    const after = value(await context.call(hand, "get_entry", { id: linking.id }));
    expect(after).toEqual({ ...linking, links: [], follow_up_to: null });
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
    expect(await context.call(hand, "restore", { id: entry.id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    // The change log still says what kind of record was made, changed and deleted, and by whom.
    const log = value(await context.call(hand, "list_changes", {})).items;
    const about = log.flatMap((change) =>
      change.effects.filter((effect) => effect.id === entry.id || effect.id === paint?.id),
    );
    expect(about.length).toBeGreaterThan(0);
    expect(new Set(about.map((effect) => effect.summary))).toEqual(new Set([""]));
  });

  test("a Task that left a Project removed for good simply has no Project", async () => {
    const context = newContext();
    const project = value(
      await context.call(hand, "create_project", { name: marked("Kitchen") }),
    ).record;
    const entry = await anEntry(context, marked("House"), [marked("Tile")]);
    const tile = entry.tasks[0];
    value(await context.call(hand, "move_task", { id: tile?.id, project_id: project.id }));
    value(await context.call(hand, "delete_project", { id: project.id }));

    const result = value(await context.call(hand, "remove_for_good", { id: project.id }));

    expect(result.effects.map(({ id }) => id)).toEqual([project.id]);
    expect(value(await context.call(hand, "get_task", { id: tile?.id })).project).toBeNull();
  });

  test("removing a Person for good leaves the Tasks once Delegated to them", async () => {
    const context = newContext();
    const ali = value(await context.call(hand, "create_person", { name: marked("Ali") })).record;
    const entry = await anEntry(context, marked("Asks"), [marked("Quote"), marked("Done")]);
    const [quote, done] = entry.tasks;
    for (const task of entry.tasks) {
      value(await context.call(hand, "delegate_task", { id: task.id, person_id: ali.id }));
    }
    value(await context.call(hand, "finish_task", { id: done?.id }));
    value(await context.call(hand, "delete_person", { id: ali.id }));

    value(await context.call(hand, "remove_for_good", { id: ali.id }));

    for (const task of [quote, done]) {
      const read = value(await context.call(hand, "get_task", { id: task?.id }));
      expect(read.state).not.toHaveProperty("delegated.to.id", ali.id);
    }
  });

  test("removing an Entry for good takes a Task of it deleted on its own", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint")]);
    const paint = entry.tasks[0];
    value(await context.call(hand, "delete_task", { id: paint?.id }));
    value(await context.call(hand, "delete_entry", { id: entry.id }));

    const result = value(await context.call(hand, "remove_for_good", { id: entry.id }));

    expect(result.record).toEqual({ items: 2 });
    expect(result.effects.map(({ id, by }) => [id, by])).toEqual([
      [entry.id, "call"],
      [paint?.id, "rule"],
    ]);
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
  });

  test("what is not in the Trash is not found", async () => {
    const context = newContext();
    const entry = await anEntry(context);

    expect(await context.call(hand, "remove_for_good", { id: entry.id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("empty_trash", () => {
  test("removes everything in the Trash for good, and an empty Trash changes nothing", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("House"), [marked("Paint")]);
    const ali = value(await context.call(hand, "create_person", { name: marked("Ali") })).record;
    value(await context.call(hand, "delete_entry", { id: entry.id }));
    value(await context.call(hand, "delete_person", { id: ali.id }));

    const result = value(await context.call(hand, "empty_trash", {}));

    expect(result.record).toEqual({ items: 2 });
    expect(result.effects.map(({ id, what, by }) => [id, what, by])).toEqual([
      [entry.id, "deleted", "call"],
      [entry.tasks[0]?.id, "deleted", "rule"],
      [ali.id, "deleted", "call"],
    ]);
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
    expect(value(await context.call(hand, "empty_trash", {}))).toEqual({
      record: { items: 0 },
      effects: [],
      changed: false,
    });
  });
});

describe("the Trash's clock", () => {
  test("the Context's alarm removes an item for good 30 days after its delete, and not before", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const first = await anEntry(context, marked("First"));
    value(await context.call(hand, "delete_entry", { id: first.id }));
    context.advance(DAY);
    const second = await anEntry(context, marked("Second"));
    value(await context.call(hand, "delete_entry", { id: second.id }));

    context.advance(29 * DAY);
    await context.fireAlarm();

    const left = value(await context.call(hand, "list_trash", {})).items;
    expect(left.map((item) => item.record.id)).toEqual([second.id]);
    context.advance(DAY - 1);
    await context.fireAlarm();
    expect(value(await context.call(hand, "list_trash", {})).items).toHaveLength(1);
    context.advance(1);
    await context.fireAlarm();
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
  });
});

describe("what a removal for good leaves", () => {
  test("emptying the Trash leaves none of the words removed in the Context 30 days on, and the keys that answered with them are forgotten", async () => {
    const context = newContext();
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("House"),
        tasks: [{ title: marked("Paint") }],
        key: "recorded",
      }),
    ).record;
    value(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("Houses"),
        version: 0,
        key: "edited",
      }),
    );
    value(await context.call(hand, "delete_entry", { id: entry.id, key: "deleted" }));
    value(await context.call(hand, "empty_trash", { key: "emptied" }));

    // The object wakes 30 days on, and the oracle finds none of their words in any table.
    context.advance(30 * DAY);
    await context.fireAlarm();

    const again = value(
      await context.call(hand, "record_entry", { words: marked("Garden"), key: "recorded" }),
    ).record;
    expect(again.id).not.toBe(entry.id);
  });

  test("the alarm's removal at 30 days leaves none of the words removed in the Context 30 days after that", async () => {
    const context = newContext();
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("House"),
        tasks: [{ title: marked("Paint") }],
        key: "recorded",
      }),
    ).record;
    value(await context.call(hand, "delete_entry", { id: entry.id, key: "deleted" }));
    context.advance(30 * DAY);
    await context.fireAlarm();
    expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);

    context.advance(30 * DAY);
    await context.fireAlarm();

    expect(await context.call(hand, "get_entry", { id: entry.id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});
