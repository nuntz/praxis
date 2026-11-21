import type { Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** A Task the person made, on an Entry of its own. */
async function aTask(context: Context, title = marked("Water the plants")): Promise<Task> {
  const { record } = value(
    await context.call(hand, "record_entry", { words: marked("Plants"), tasks: [{ title }] }),
  );
  return record.tasks[0] as Task;
}

// An Unsent write carries the time it was made (section 4.6, ADR 0020): it sets the Entry's time
// and the Task's closing day, and the change log records when the call arrived.

describe("record_entry made at an earlier time", () => {
  test("the Entry and its Tasks take that time, and the change log says when the call arrived", async () => {
    const context = newContext("2026-11-15T11:00:00.000Z");
    const before = value(await context.call(hand, "record_entry", { words: marked("At ten") }));
    const madeAt = "2026-11-15T09:10:00.000Z";

    const { record } = value(
      await context.call(hand, "record_entry", {
        words: marked("In the lift\n[] Ring the bank"),
        tasks: [{ title: marked("Ring the bank") }],
        made_at: madeAt,
      }),
    );

    expect(record.at).toBe(madeAt);
    expect(record.tasks.map((task) => task.at)).toEqual([madeAt]);
    // The Journal is in time order: made earlier, it comes after the one recorded before it.
    const listed = value(await context.call(hand, "list_entries", {})).items;
    expect(listed.map((entry) => entry.id)).toEqual([before.record.id, record.id]);
    const { items } = value(await context.call(hand, "list_changes", {}));
    expect(items.at(-1)).toMatchObject({ tool: "record_entry", at: "2026-11-15T11:00:00.000Z" });
  });

  test("a time in the future is refused, and changes nothing", async () => {
    const context = newContext("2026-11-15T11:00:00.000Z");

    const result = await context.call(hand, "record_entry", {
      words: marked("Not yet"),
      made_at: "2026-11-15T11:00:01.000Z",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual([]);
  });

  test("is offered to the hand only: the Agent and a Connection may not say when it was made", async () => {
    const context = newContext("2026-11-15T11:00:00.000Z");

    for (const caller of [agent, connection]) {
      const result = await context.call(caller, "record_entry", {
        words: marked("Earlier, they say"),
        made_at: "2026-11-15T09:00:00.000Z",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual([]);
  });
});

describe("finish_task made at an earlier time", () => {
  test("the Task is Finished then, and its Recurrence counts from that day", async () => {
    const context = newContext("2026-11-16T09:00:00.000Z");
    const task = await aTask(context);
    value(await context.call(hand, "set_task_dates", { id: task.id, due_date: "2026-11-20" }));
    const recurrence = { kind: "interval", every: 10, unit: "days" } as const;
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence }));
    context.advance(3 * DAY);
    const madeAt = "2026-11-17T18:30:00.000Z";

    const finished = value(
      await context.call(hand, "finish_task", { id: task.id, made_at: madeAt }),
    );

    expect(finished.record.state).toEqual({ is: "finished", at: madeAt });
    const [, next] = value(await context.call(hand, "get_entry", { id: task.origin_entry })).tasks;
    // Closed on the 17th, not the 19th it arrived on.
    expect(next?.due_date).toBe("2026-11-27");
    const { items } = value(await context.call(hand, "list_changes", {}));
    expect(items.at(-1)).toMatchObject({ tool: "finish_task", at: "2026-11-19T09:00:00.000Z" });
  });
});

describe("an Unsent write on arrival is judged against the Journal as it now is", () => {
  const madeAt = "2026-11-15T09:10:00.000Z";

  test("finishing a Task Finished meanwhile succeeds with no Effects, and runs no Recurrence again", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const task = await aTask(context);
    value(await context.call(hand, "set_task_dates", { id: task.id, due_date: "2026-11-20" }));
    const recurrence = { kind: "interval", every: 7, unit: "days" } as const;
    value(await context.call(hand, "set_recurrence", { id: task.id, recurrence }));
    context.advance(DAY);
    value(await context.call(hand, "finish_task", { id: task.id }));

    const late = value(await context.call(hand, "finish_task", { id: task.id, made_at: madeAt }));

    expect(late.effects).toEqual([]);
    expect(late.record.state).toEqual({ is: "finished", at: "2026-11-16T09:00:00.000Z" });
    const { tasks } = value(await context.call(hand, "get_entry", { id: task.origin_entry }));
    expect(tasks).toHaveLength(2);
  });

  test("finishing a Task Dropped meanwhile is refused, and one deleted is not found", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const dropped = await aTask(context);
    const deleted = await aTask(context, marked("Paint the gate"));
    value(await context.call(hand, "drop_task", { id: dropped.id }));
    value(await context.call(hand, "delete_entry", { id: deleted.origin_entry }));
    context.advance(DAY);

    const refused = await context.call(hand, "finish_task", { id: dropped.id, made_at: madeAt });
    const gone = await context.call(hand, "finish_task", { id: deleted.id, made_at: madeAt });

    expect(refused).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(gone).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("an Entry linking to a record deleted meanwhile is recorded, with that link dormant", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const paint = await aTask(context, marked("Paint the gate"));
    value(await context.call(hand, "delete_entry", { id: paint.origin_entry }));
    context.advance(DAY);

    const { record } = value(
      await context.call(hand, "record_entry", {
        words: marked("Bought the paint"),
        links: [{ to: { kind: "task", id: paint.id } }],
        made_at: madeAt,
      }),
    );

    expect(record.at).toBe(madeAt);
    expect(record.links).toEqual([
      {
        kind: "reference",
        to: expect.objectContaining({ id: paint.id, deleted: true }),
        anchor: null,
      },
    ]);
  });
});
