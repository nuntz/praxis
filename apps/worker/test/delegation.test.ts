import type { Person, Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, DAY, hand, newContext, readOnlyConnection, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

async function aTask(context: Context) {
  const title = marked("Chase the quote");
  const { record: entry } = value(
    await context.call(hand, "record_entry", { words: marked("Quote"), tasks: [{ title }] }),
  );
  return entry.tasks[0] as Task;
}

async function aPerson(context: Context, name = marked("Alice Moreau")): Promise<Person> {
  return value(await context.call(hand, "create_person", { name })).record;
}

/** The state of an open Task with no dates that this Person has been doing since then. */
function delegatedTo(person: Person, since: string) {
  return {
    is: "open",
    actionable: false,
    waiting: null,
    delegated: { to: { id: person.id, name: person.name }, since },
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

describe("delegate_task", () => {
  test("hands a Task to a Person, read with who and since when, and no longer actionable", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const task = await aTask(context);
    const alice = await aPerson(context);
    context.advance(DAY);

    const result = value(
      await context.call(connection, "delegate_task", { id: task.id, person_id: alice.id }),
    );

    const delegated = { ...task, state: delegatedTo(alice, "2026-11-16T09:00:00.000Z") };
    expect(result.record).toEqual(delegated);
    expect(result.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
    expect(value(await context.call(readOnlyConnection, "get_task", { id: task.id }))).toEqual(
      delegated,
    );
  });

  test("delegating to the Person doing it changes nothing; to another hands it on, since then", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const task = await aTask(context);
    const [alice, bob] = [await aPerson(context), await aPerson(context, marked("Bob Lin"))];
    const first = value(
      await context.call(hand, "delegate_task", { id: task.id, person_id: alice.id }),
    );
    context.advance(DAY);

    const again = value(
      await context.call(agent, "delegate_task", { id: task.id, person_id: alice.id }),
    );
    const handedOn = value(
      await context.call(agent, "delegate_task", { id: task.id, person_id: bob.id }),
    );

    expect(again).toEqual({ record: first.record, effects: [], changed: false });
    expect(handedOn.record.state).toEqual(delegatedTo(bob, "2026-11-16T09:00:00.000Z"));
    expect(handedOn.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
  });

  test("a closed Task is refused until it is reopened, and the refusal names it", async () => {
    const context = newContext();
    const finished = await aTask(context);
    const dropped = await aTask(context);
    const alice = await aPerson(context);
    value(await context.call(hand, "finish_task", { id: finished.id }));
    value(await context.call(hand, "drop_task", { id: dropped.id }));

    for (const task of [finished, dropped]) {
      const result = await context.call(agent, "delegate_task", {
        id: task.id,
        person_id: alice.id,
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

  test("a Task or Person not in this Context is not found", async () => {
    const context = newContext();
    const elsewhere = newContext();
    const [task, alice] = [await aTask(context), await aPerson(context)];
    const [otherTask, otherPerson] = [await aTask(elsewhere), await aPerson(elsewhere)];

    for (const input of [
      { id: otherTask.id, person_id: alice.id },
      { id: task.id, person_id: otherPerson.id },
      { id: task.id, person_id: "no-such-person" },
    ]) {
      const result = await context.call(hand, "delegate_task", input);
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });

  test("the Task reads the Person by the name they have now", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const task = await aTask(context);
    const alice = await aPerson(context);
    value(await context.call(hand, "delegate_task", { id: task.id, person_id: alice.id }));
    const renamed = value(
      await context.call(hand, "rename_person", { id: alice.id, name: marked("Alice Durand") }),
    ).record;

    expect(value(await context.call(hand, "get_task", { id: task.id })).state).toEqual(
      delegatedTo(renamed, "2026-11-15T09:00:00.000Z"),
    );
  });
});

describe("a Mention", () => {
  test("never delegates: a Task whose Entry Mentions a Person is not Delegated to them", async () => {
    const context = newContext();
    const alice = await aPerson(context);

    const { record: entry } = value(
      await context.call(agent, "record_entry", {
        words: marked("Alice will chase the quote"),
        tasks: [{ title: marked("Chase the quote") }],
        links: [{ to: { kind: "person", id: alice.id } }],
      }),
    );
    const task = entry.tasks[0] as Task;
    value(
      await context.call(connection, "add_link", {
        entry_id: entry.id,
        to: { kind: "person", id: alice.id },
        anchor: { start: 0, end: 5 },
      }),
    );

    expect(value(await context.call(hand, "get_task", { id: task.id })).state).toEqual(actionable);
  });
});

describe("take_back_task", () => {
  test("ends the delegation, and the Task is the person's to act on again", async () => {
    const context = newContext();
    const task = await aTask(context);
    const alice = await aPerson(context);
    value(await context.call(hand, "delegate_task", { id: task.id, person_id: alice.id }));
    context.advance(DAY);

    const result = value(await context.call(connection, "take_back_task", { id: task.id }));

    expect(result.record).toEqual({ ...task, state: actionable });
    expect(result.effects).toEqual([
      { kind: "task", id: task.id, what: "changed", summary: task.title, by: "call" },
    ]);
  });

  test("taking back a Task no one is doing changes nothing, open or closed", async () => {
    const context = newContext();
    const open = await aTask(context);
    const finished = await aTask(context);
    const { record: closed } = value(await context.call(hand, "finish_task", { id: finished.id }));

    for (const task of [open, closed]) {
      expect(value(await context.call(agent, "take_back_task", { id: task.id }))).toEqual({
        record: task,
        effects: [],
        changed: false,
      });
    }
  });

  test("a Task not in this Context is not found", async () => {
    const { id } = await aTask(newContext());

    const result = await newContext().call(hand, "take_back_task", { id });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("a delegation", () => {
  test.each(["finish_task", "drop_task"] as const)(
    "ends when the Task is closed by %s, and reopening does not bring it back",
    async (tool) => {
      const context = newContext();
      const task = await aTask(context);
      const alice = await aPerson(context);
      value(await context.call(hand, "delegate_task", { id: task.id, person_id: alice.id }));
      value(await context.call(hand, tool, { id: task.id }));

      const reopened = value(await context.call(hand, "reopen_task", { id: task.id }));

      expect(reopened.record.state).toEqual(actionable);
      expect(value(await context.call(hand, "take_back_task", { id: task.id })).changed).toBe(
        false,
      );
    },
  );

  test("ends when the Project the Task is in is closed, which drops it", async () => {
    const context = newContext();
    const task = await aTask(context);
    const alice = await aPerson(context);
    const { record: project } = value(
      await context.call(hand, "create_project", { name: marked("Kitchen") }),
    );
    value(await context.call(hand, "move_task", { id: task.id, project_id: project.id }));
    value(await context.call(hand, "delegate_task", { id: task.id, person_id: alice.id }));
    value(await context.call(hand, "finish_project", { id: project.id }));

    const reopened = value(await context.call(hand, "reopen_task", { id: task.id }));

    expect(reopened.record.state).toEqual(actionable);
  });
});
