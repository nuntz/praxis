import { type MessagesPage, summarizeWords } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { calling, scriptModel } from "./model-fake.ts";
import { agent, atOnce, clock, connection, DAY, hand, left, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** An Entry recorded by this caller, with these Tasks, as the write returned it. */
async function recorded(context: Context, words: string, caller = hand, tasks: string[] = []) {
  return value(
    await context.call(caller, "record_entry", {
      words,
      tasks: tasks.map((title) => ({ title })),
    }),
  ).record;
}

/** The Held Changes waiting, as the person's hand lists them. */
async function waiting(context: Context) {
  return value(await context.call(hand, "list_held_changes", {})).items;
}

describe("edit_entry by the Agent on the person's words", () => {
  test("leaves a Held Change showing the Entry before and after, and changes nothing else", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const before = marked("Called the landlord");
    const entry = await recorded(context, before);

    const after = marked("Called the landlord about the boiler");
    const result = left(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: after,
        version: 0,
        tasks: [{ title: "Chase the boiler" }],
      }),
    );

    const held = {
      id: expect.any(String),
      tool: "edit_entry",
      summary: "Edit your Entry's words",
      entry: { id: entry.id, summary: before },
      before,
      after,
      new_tasks: [{ title: "Chase the boiler" }],
      goes_with: [],
      at: "2026-11-15T09:00:00.000Z",
    };
    expect(result).toEqual({
      record: held,
      effects: [
        {
          kind: "held_change",
          id: result.record.id,
          what: "made",
          summary: "Edit your Entry's words",
          by: "call",
        },
      ],
      changed: true,
      held: true,
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
    expect(await waiting(context)).toEqual([held]);
  });
});

describe("edit_entry by the Agent, checked before it leaves a Held Change", () => {
  test("a change against a Version no longer current is stale, and leaves none", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Draft"));
    atOnce(
      await context.call(hand, "edit_entry", { id: entry.id, words: marked("Mine"), version: 0 }),
    );

    const result = await context.call(agent, "edit_entry", {
      id: entry.id,
      words: marked("Theirs"),
      version: 0,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "stale" } });
    expect(await waiting(context)).toEqual([]);
  });

  test("the words it already has change nothing and leave none", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Unchanged"));

    const result = atOnce(
      await context.call(agent, "edit_entry", { id: entry.id, words: entry.words, version: 0 }),
    );

    expect(result).toEqual({ record: entry, effects: [], changed: false });
    expect(await waiting(context)).toEqual([]);
  });

  test("a Connection is still refused, and leaves none", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("The person's own"));

    for (const tool of ["edit_entry", "restore_entry_version", "delete_entry"] as const) {
      const input =
        tool === "delete_entry"
          ? { id: entry.id }
          : tool === "edit_entry"
            ? { id: entry.id, words: marked("Overwritten"), version: 0 }
            : { id: entry.id, restore: 0, version: 0 };
      expect(await context.call(connection, tool, input), tool).toMatchObject({
        ok: false,
        error: { code: tool === "restore_entry_version" ? "not_found" : "held" },
      });
    }
    expect(await waiting(context)).toEqual([]);
  });
});

describe("make_held_change", () => {
  test("makes the edit as shown, the Agent's change to the person's Entry, with its Tasks", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const before = marked("Called the landlord");
    const entry = await recorded(context, before);
    const after = marked("Called the landlord\n[] Chase the boiler");
    const held = left(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: after,
        version: 0,
        tasks: [{ title: "Chase the boiler" }],
      }),
    ).record;

    context.advance(DAY);
    const result = value(await context.call(hand, "make_held_change", { id: held.id }));

    const now = value(await context.call(hand, "get_entry", { id: entry.id }));
    expect(now).toMatchObject({
      words: after,
      version: 1,
      author: { kind: "person" },
      edited: { by: { kind: "agent" }, at: "2026-11-16T09:00:00.000Z" },
      tasks: [{ title: "Chase the boiler", origin_entry: entry.id }],
    });
    expect(result.record).toEqual(held);
    expect(result.effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: summarizeWords(after), by: "call" },
      {
        kind: "task",
        id: now.tasks[0]?.id,
        what: "made",
        summary: "Chase the boiler",
        by: "call",
      },
      { kind: "held_change", id: held.id, what: "deleted", summary: held.summary, by: "call" },
    ]);
    expect(value(await context.call(hand, "list_entry_versions", { id: entry.id })).items).toEqual([
      { version: 0, words: before, changed: { by: { kind: "agent" }, at: now.edited?.at } },
    ]);
    expect(await waiting(context)).toEqual([]);
  });

  test("makes a restore as shown", async () => {
    const context = newContext();
    const first = marked("First words");
    const second = marked("Second");
    const entry = await recorded(context, first);
    atOnce(await context.call(hand, "edit_entry", { id: entry.id, words: second, version: 0 }));
    const held = left(
      await context.call(agent, "restore_entry_version", { id: entry.id, restore: 0, version: 1 }),
    ).record;
    expect(held).toMatchObject({
      tool: "restore_entry_version",
      summary: "Restore an earlier Version of your Entry",
      before: second,
      after: first,
      new_tasks: [],
    });

    value(await context.call(hand, "make_held_change", { id: held.id }));

    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toMatchObject({
      words: first,
      version: 2,
      edited: { by: { kind: "agent" } },
    });
  });

  test("makes a delete as shown, with the Tasks it listed", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const entry = await recorded(context, marked("House"), hand, [marked("Paint"), marked("Sand")]);
    const held = left(await context.call(agent, "delete_entry", { id: entry.id })).record;
    expect(held).toMatchObject({
      tool: "delete_entry",
      summary: "Delete your Entry",
      before: entry.words,
      after: null,
      goes_with: entry.tasks.map((task) => ({ kind: "task", id: task.id, summary: task.title })),
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);

    const result = value(await context.call(hand, "make_held_change", { id: held.id }));

    expect(result.effects.map(({ kind, id, what }) => [kind, id, what])).toEqual([
      ["entry", entry.id, "deleted"],
      ...entry.tasks.map((task) => ["task", task.id, "deleted"]),
      ["held_change", held.id, "deleted"],
    ]);
    const [item] = value(await context.call(hand, "list_trash", {})).items;
    expect(item).toMatchObject({
      record: { kind: "entry", id: entry.id },
      went_with: held.goes_with,
    });
  });

  test("a Held Change no longer waiting is not found, and nothing changes", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Mine"));
    const held = left(await context.call(agent, "delete_entry", { id: entry.id })).record;
    value(await context.call(hand, "cancel_held_change", { id: held.id }));

    const result = await context.call(hand, "make_held_change", { id: held.id });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
  });

  test("a Standing Entry's words that would now pass the ceiling are refused, and it stays waiting", async () => {
    const context = newContext();
    const entry = await recorded(context, "a".repeat(4_000));
    value(await context.call(hand, "mark_standing", { id: entry.id }));
    const held = left(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: "a".repeat(6_000),
        version: 0,
      }),
    ).record;
    const other = await recorded(context, "b".repeat(4_001));
    value(await context.call(hand, "mark_standing", { id: other.id }));

    const result = await context.call(hand, "make_held_change", { id: held.id });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "entry", id: other.id }] },
    });
    expect((await waiting(context)).map(({ id }) => id)).toEqual([held.id]);
  });
});

describe("cancel_held_change", () => {
  test("by the hand or the Agent, the Held Change is gone and the Entry stays as it is", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Mine"));

    for (const caller of [hand, agent]) {
      const held = left(
        await context.call(agent, "edit_entry", {
          id: entry.id,
          words: marked("Theirs"),
          version: 0,
        }),
      ).record;

      const result = value(await context.call(caller, "cancel_held_change", { id: held.id }));

      expect(result).toEqual({
        record: held,
        effects: [
          { kind: "held_change", id: held.id, what: "deleted", summary: held.summary, by: "call" },
        ],
        changed: true,
      });
      expect(await waiting(context)).toEqual([]);
    }
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
  });
});

describe("a Held Change lapses", () => {
  /** An Entry of the person's with a Held Change the Agent left on it to change its words. */
  async function heldEdit(context: Context) {
    const entry = await recorded(context, marked("Mine"), hand, [marked("Do it")]);
    const held = left(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: marked("Theirs"),
        version: 0,
      }),
    ).record;
    return { entry, held };
  }

  const lapsedBy = (held: { id: string; summary: string }) => ({
    kind: "held_change",
    id: held.id,
    what: "deleted",
    summary: held.summary,
    by: "rule",
  });

  test("the moment the person changes the Entry's words, as an Effect of that change", async () => {
    const context = newContext();
    const { entry, held } = await heldEdit(context);

    const result = atOnce(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("Mine, more"),
        version: 0,
      }),
    );

    expect(result.effects).toContainEqual(lapsedBy(held));
    expect(await waiting(context)).toEqual([]);
    expect(await context.call(hand, "make_held_change", { id: held.id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("when the Entry goes to the Trash, and does not come back with it", async () => {
    const context = newContext();
    const { entry, held } = await heldEdit(context);

    const deleted = atOnce(await context.call(hand, "delete_entry", { id: entry.id }));
    value(await context.call(hand, "restore", { id: entry.id }));

    expect(deleted.effects).toContainEqual(lapsedBy(held));
    expect(await waiting(context)).toEqual([]);
  });

  test("when another Held Change on the Entry is made", async () => {
    const context = newContext();
    const { entry, held } = await heldEdit(context);
    const other = left(await context.call(agent, "delete_entry", { id: entry.id })).record;

    const result = value(await context.call(hand, "make_held_change", { id: held.id }));

    expect(result.effects).toContainEqual(lapsedBy(other));
    expect(await waiting(context)).toEqual([]);
  });

  test("a delete's, when the Tasks that would go with the Entry change; an edit's does not", async () => {
    const context = newContext();
    const { entry, held } = await heldEdit(context);
    const deleting = left(await context.call(agent, "delete_entry", { id: entry.id })).record;

    const added = value(
      await context.call(hand, "add_task", { entry_id: entry.id, title: marked("Another") }),
    );

    expect(added.effects).toEqual([
      expect.objectContaining({ kind: "task", what: "made" }),
      lapsedBy(deleting),
    ]);
    expect((await waiting(context)).map(({ id }) => id)).toEqual([held.id]);
  });

  test("a delete's, when finishing a recurring Task makes its next Occurrence on the Entry", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Bins"), hand, [marked("Put the bins out")]);
    const task = entry.tasks[0];
    value(await context.call(hand, "set_task_dates", { id: task?.id, due_date: "2026-11-16" }));
    value(
      await context.call(hand, "set_recurrence", {
        id: task?.id,
        recurrence: { kind: "weeks", every: 1, on: ["monday"] },
      }),
    );
    const deleting = left(await context.call(agent, "delete_entry", { id: entry.id })).record;

    const finished = atOnce(await context.call(hand, "finish_task", { id: task?.id }));

    expect(finished.effects).toContainEqual(lapsedBy(deleting));
    expect(await waiting(context)).toEqual([]);
  });

  test("not for a change beside the words: a link, a mark, or a Task's own change", async () => {
    const context = newContext();
    const { entry, held } = await heldEdit(context);
    const deleting = left(await context.call(agent, "delete_entry", { id: entry.id })).record;

    value(
      await context.call(hand, "add_link", {
        entry_id: entry.id,
        to: { kind: "new_person", name: marked("Ali") },
      }),
    );
    value(await context.call(hand, "mark_standing", { id: entry.id }));
    value(await context.call(hand, "finish_task", { id: entry.tasks[0]?.id }));

    expect((await waiting(context)).map(({ id }) => id).toSorted()).toEqual(
      [held.id, deleting.id].toSorted(),
    );
  });
});

describe("an Entry the Agent composed", () => {
  test("is changed by the Agent at once until the person edits it, and its words are held from then on", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Composed"), agent);
    atOnce(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: marked("Composed, amended"),
        version: 0,
      }),
    );
    const mine = marked("Mine now");
    atOnce(await context.call(hand, "edit_entry", { id: entry.id, words: mine, version: 1 }));

    const result = left(
      await context.call(agent, "edit_entry", {
        id: entry.id,
        words: marked("Amended again"),
        version: 2,
      }),
    );

    expect(result).toMatchObject({ held: true, record: { tool: "edit_entry" } });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toMatchObject({
      words: mine,
      author: { kind: "person" },
    });
  });
});

describe("list_held_changes", () => {
  test("is offered to the hand, the Agent and the Clock alike, newest first", async () => {
    const context = newContext();
    const first = await recorded(context, marked("First"));
    const second = await recorded(context, marked("Second"));
    const older = left(await context.call(agent, "delete_entry", { id: first.id })).record;
    context.advance(1000);
    const newer = left(await context.call(agent, "delete_entry", { id: second.id })).record;

    for (const caller of [hand, agent, clock]) {
      expect(value(await context.call(caller, "list_held_changes", {}))).toEqual({
        items: [newer, older],
        next_cursor: null,
      });
    }
  });

  test("a Connection reads nothing of one in the change log", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Mine"));
    const held = left(await context.call(agent, "delete_entry", { id: entry.id })).record;
    value(await context.call(hand, "make_held_change", { id: held.id }));

    const seen = value(await context.call(connection, "list_changes", {})).items;

    expect(seen.map(({ tool }) => tool)).toEqual(["record_entry", "make_held_change"]);
    expect(seen.flatMap(({ effects }) => effects).map(({ kind }) => kind)).not.toContain(
      "held_change",
    );
    const all = value(await context.call(hand, "list_changes", {})).items;
    expect(all.map(({ tool }) => tool)).toEqual([
      "record_entry",
      "delete_entry",
      "make_held_change",
    ]);
  });
});

describe("send_message: the Agent's held call", () => {
  test("leaves a Held Change in a Run, which waits in the Conversation where the Agent left it", async () => {
    const context = newContext();
    const entry = await recorded(context, marked("Called the landlord"));
    const words = marked("Called the landlord, fixed the typo");
    scriptModel(calling([() => ["edit_entry", { id: entry.id, words, version: entry.version }]]));

    await context.callAny(hand, "send_message", { words: marked("Fix the typo in that Entry") });
    await context.runsEnded();

    const [held] = await waiting(context);
    expect(held).toMatchObject({ tool: "edit_entry", entry: { id: entry.id }, after: words });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
    const [answer] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
      .items;
    expect(answer).toMatchObject({
      from: "agent",
      run: {
        calls: [
          {
            tool: "edit_entry",
            result: "ok",
            effects: [{ kind: "held_change", id: held?.id, what: "made" }],
          },
        ],
      },
    });
  });
});
