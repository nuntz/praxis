import type { Entry, MoveUnit, Task } from "@praxis/domain";
import { afterEach, describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { clearMoveFaults, failMovesInto, stickContext } from "./move-faults.ts";
import { agent, atOnce, DAY, everyCaller, hand, left, newDeployment, value } from "./seam.ts";

// Moving a record between Contexts (section 3.9, ADR 0003 and 0006): the one act that crosses the
// boundary. Only the person's hand moves a record, and it takes a whole unit, which the person
// sees before confirming. What links across is dropped with the words kept, and the unit is
// never lost and never in both Contexts.

type Deployment = ReturnType<typeof newDeployment>;
type Reached = ReturnType<Deployment["context"]>;

afterEach(() => clearMoveFaults());

/** A Deployment with two Contexts, Work and Home, each reached as the Worker reaches it. */
async function twoContexts(startAt?: string) {
  const deployment = newDeployment(startAt);
  const made = async (name: string) =>
    value(await deployment.call(hand, "create_context", { name, time_zone: "UTC", accent: "blue" }))
      .record;
  const work = await made("Work");
  const home = await made("Home");
  return {
    deployment,
    work,
    home,
    from: deployment.context(work.id),
    to: deployment.context(home.id),
  };
}

async function anEntry(
  context: Reached,
  words: string,
  more: { tasks?: string[]; follow_up_to?: string; links?: unknown[] } = {},
): Promise<Entry> {
  return atOnce(
    await context.call(hand, "record_entry", {
      words,
      tasks: (more.tasks ?? []).map((title) => ({ title })),
      ...(more.follow_up_to ? { follow_up_to: more.follow_up_to } : {}),
      ...(more.links ? { links: more.links } : {}),
    }),
  ).record;
}

async function unitOf(context: Reached, kind: "entry" | "project", id: string): Promise<MoveUnit> {
  return value(await context.call(hand, "get_move_unit", { kind, id }));
}

/** Move a record with the unit get_move_unit shows for it, as the screen does once confirmed. */
async function move(
  deployment: Deployment,
  from: string,
  to: string,
  context: Reached,
  record: { kind: "entry" | "project"; id: string },
) {
  const shown = await unitOf(context, record.kind, record.id);
  return deployment.call(hand, "move_record", {
    from,
    to,
    record,
    unit: shown.unit.map(({ id }) => id),
  });
}

const ids = (records: { id: string }[]) => records.map(({ id }) => id);

describe("get_move_unit", () => {
  test("an Entry's unit is the Entry, its Follow-ups and theirs, and the Tasks that came from them, every Occurrence among them", async () => {
    const { from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), { tasks: [marked("Water")] });
    const water = entry.tasks[0] as Task;
    value(await from.call(hand, "set_task_dates", { id: water.id, due_date: "2026-11-16" }));
    value(
      await from.call(hand, "set_recurrence", {
        id: water.id,
        recurrence: { kind: "days", every: 1 },
      }),
    );
    const next = atOnce(await from.call(hand, "finish_task", { id: water.id })).effects.find(
      (effect) => effect.kind === "task" && effect.what === "made",
    );
    const followUp = await anEntry(from, marked("Roses too"), {
      follow_up_to: entry.id,
      tasks: [marked("Prune")],
    });
    const later = await anEntry(from, marked("And the hedge"), { follow_up_to: followUp.id });
    await anEntry(from, marked("Elsewhere"), { tasks: [marked("Not this")] });

    const shown = await unitOf(from, "entry", entry.id);

    expect(shown.record).toMatchObject({ kind: "entry", id: entry.id });
    expect(shown.unit).toEqual([
      { kind: "entry", id: entry.id, summary: expect.any(String) },
      { kind: "entry", id: followUp.id, summary: expect.any(String) },
      { kind: "entry", id: later.id, summary: expect.any(String) },
      { kind: "task", id: water.id, summary: expect.any(String) },
      { kind: "task", id: next?.id, summary: expect.any(String) },
      { kind: "task", id: followUp.tasks[0]?.id, summary: expect.any(String) },
    ]);
    expect(shown.in_the_trash).toEqual([]);
  });

  test("a Project's unit is the Project, its Tasks, their Origin Entries with their Follow-ups, and the other Tasks those Entries made, and goes no further", async () => {
    const { from } = await twoContexts();
    const project = atOnce(
      await from.call(hand, "create_project", { name: marked("Move house") }),
    ).record;
    const other = atOnce(
      await from.call(hand, "create_project", { name: marked("Garden") }),
    ).record;
    const entry = await anEntry(from, marked("Plan"), {
      tasks: [marked("Boxes"), marked("Seeds")],
    });
    const [boxes, seeds] = entry.tasks as [Task, Task];
    atOnce(await from.call(hand, "move_task", { id: boxes.id, project_id: project.id }));
    atOnce(await from.call(hand, "move_task", { id: seeds.id, project_id: other.id }));
    const followUp = await anEntry(from, marked("Van booked"), { follow_up_to: entry.id });
    // A Task of the other Project from an Entry that stays: the unit goes no further.
    const elsewhere = await anEntry(from, marked("Beds"), { tasks: [marked("Dig")] });
    atOnce(
      await from.call(hand, "move_task", { id: elsewhere.tasks[0]?.id, project_id: other.id }),
    );

    const shown = await unitOf(from, "project", project.id);

    expect(shown.unit.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "project", id: project.id },
      { kind: "entry", id: entry.id },
      { kind: "entry", id: followUp.id },
      { kind: "task", id: boxes.id },
      { kind: "task", id: seeds.id },
    ]);
  });

  test("nothing in the Trash is in a unit, and a Task in the Trash whose Origin Entry would go is named", async () => {
    const { from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), {
      tasks: [marked("Water"), marked("Mow")],
    });
    const followUp = await anEntry(from, marked("Later"), { follow_up_to: entry.id });
    value(await from.call(hand, "delete_entry", { id: followUp.id }));
    const mow = entry.tasks[1] as Task;
    value(await from.call(hand, "delete_task", { id: mow.id }));

    const shown = await unitOf(from, "entry", entry.id);

    expect(ids(shown.unit)).toEqual([entry.id, entry.tasks[0]?.id]);
    expect(shown.in_the_trash).toEqual([{ kind: "task", id: mow.id, summary: expect.any(String) }]);
  });

  test("a record in the Trash, or none, has no unit", async () => {
    const { from } = await twoContexts();
    const entry = await anEntry(from, marked("Gone"));
    value(await from.call(hand, "delete_entry", { id: entry.id }));

    for (const [kind, id] of [
      ["entry", entry.id],
      ["entry", "no-such-entry"],
      ["project", "no-such-project"],
    ] as const) {
      expect(await from.call(hand, "get_move_unit", { kind, id })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });
});

describe("move_record", () => {
  test("moves an Entry's unit with every id, Version, Recurrence and Author, and it is never in both Contexts", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = atOnce(
      await from.call(agent, "record_entry", {
        words: marked("Garden"),
        tasks: [{ title: marked("Water") }],
      }),
    ).record;
    const water = entry.tasks[0] as Task;
    value(await from.call(hand, "set_task_dates", { id: water.id, due_date: "2026-11-20" }));
    value(
      await from.call(hand, "set_recurrence", {
        id: water.id,
        recurrence: { kind: "days", every: 2 },
      }),
    );
    const edited = atOnce(
      await from.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("Garden, front"),
        version: 0,
      }),
    ).record;
    const followUp = await anEntry(from, marked("Roses"), { follow_up_to: entry.id });
    const before = {
      entry: value(await from.call(hand, "get_entry", { id: entry.id })),
      followUp: value(await from.call(hand, "get_entry", { id: followUp.id })),
      versions: value(await from.call(hand, "list_entry_versions", { id: entry.id })),
    };

    const moved = value(
      await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }),
    );

    expect(moved.record).toMatchObject({
      record: { kind: "entry", id: entry.id },
      from: work,
      to: home,
      arrived: true,
    });
    expect(ids(moved.record.unit)).toEqual([entry.id, followUp.id, water.id]);
    const gone = moved.record.unit.map(({ kind, id }, place) => ({
      kind,
      id,
      what: "deleted",
      by: place === 0 ? "call" : "rule",
    }));
    const made = gone.map((effect) => ({ ...effect, what: "made" }));
    expect(moved.effects.map(({ kind, id, what, by }) => ({ kind, id, what, by }))).toEqual([
      ...gone,
      ...made,
    ]);
    // The Context it left has none of it.
    for (const id of [entry.id, followUp.id]) {
      expect(await from.call(hand, "get_entry", { id })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
    expect(value(await from.call(hand, "list_entries", {})).items).toEqual([]);
    expect(value(await from.call(hand, "search", { words: "Garden" })).items).toEqual([]);
    // The Context it went to has all of it, as it was.
    expect(value(await to.call(hand, "get_entry", { id: entry.id }))).toEqual(before.entry);
    expect(value(await to.call(hand, "get_entry", { id: followUp.id }))).toEqual(before.followUp);
    expect(value(await to.call(hand, "list_entry_versions", { id: entry.id }))).toEqual(
      before.versions,
    );
    expect(edited.edited).toEqual(before.entry.edited);
    expect(value(await to.call(hand, "get_task", { id: water.id })).recurrence).toEqual({
      kind: "days",
      every: 2,
      from: "2026-11-20",
    });
    expect(ids(value(await to.call(hand, "search", { words: "Garden" })).items)).toEqual([
      entry.id,
    ]);
  });

  test("both Contexts' change logs record the move, as the hand's", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));

    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));

    for (const [context, what, summary] of [
      [from, "deleted", ""],
      [to, "made", entry.words],
    ] as const) {
      const { items } = value(await context.call(hand, "list_changes", {}));
      expect(items.at(-1)).toMatchObject({
        caller: { kind: "hand" },
        tool: "move_record",
        effects: [{ kind: "entry", id: entry.id, what, summary, by: "call" }],
      });
    }
    // None of its words stays in the Context it left, as for a record removed for good.
    const { items } = value(await from.call(hand, "list_changes", {}));
    expect(items.flatMap(({ effects }) => effects.map(({ summary }) => summary))).toEqual(["", ""]);
  });

  test("what links across the boundary is dropped with the words kept, each an Effect on what stays", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const ali = atOnce(await from.call(hand, "create_person", { name: marked("Ali") })).record;
    const kept = atOnce(await from.call(hand, "create_project", { name: marked("Kept") })).record;
    const stays = await anEntry(from, marked("Stays"), { tasks: [marked("Staying task")] });
    const stayingTask = stays.tasks[0] as Task;
    const words = marked("Garden with @Ali");
    const entry = await anEntry(from, words, {
      tasks: [marked("Water"), marked("Mow")],
      follow_up_to: stays.id,
      links: [
        { to: { kind: "person", id: ali.id } },
        { to: { kind: "task", id: stayingTask.id } },
        { to: { kind: "project", id: kept.id } },
      ],
    });
    const [water, mow] = entry.tasks as [Task, Task];
    // An Entry that stays refers to a Task that goes; a Task that stays waits on one that goes,
    // and one that goes waits on one that stays and on one that goes with it.
    const referring = await anEntry(from, marked("About watering"), {
      links: [{ to: { kind: "task", id: water.id } }],
    });
    atOnce(
      await from.call(hand, "wait_on", { id: stayingTask.id, on: { kind: "task", id: mow.id } }),
    );
    atOnce(
      await from.call(hand, "wait_on", { id: water.id, on: { kind: "task", id: stayingTask.id } }),
    );
    atOnce(await from.call(hand, "wait_on", { id: water.id, on: { kind: "task", id: mow.id } }));
    atOnce(await from.call(hand, "delegate_task", { id: mow.id, person_id: ali.id }));
    atOnce(await from.call(hand, "move_task", { id: mow.id, project_id: kept.id }));
    atOnce(await from.call(hand, "mark_standing", { id: entry.id }));

    const moved = value(
      await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }),
    );

    // What stays, and lost its link, is changed by rule; the Person and the Project are not.
    expect(
      moved.effects
        .filter((effect) => effect.what === "changed")
        .map(({ kind, id, by }) => ({ kind, id, by })),
    ).toEqual([
      { kind: "entry", id: referring.id, by: "rule" },
      { kind: "task", id: stayingTask.id, by: "rule" },
    ]);
    expect(value(await from.call(hand, "get_entry", { id: referring.id })).links).toEqual([]);
    const left = value(await from.call(hand, "get_task", { id: stayingTask.id }));
    expect(left.state).toMatchObject({ is: "open", waiting: null });
    expect(value(await from.call(hand, "get_person", { id: ali.id })).name).toBe(ali.name);
    expect(value(await from.call(hand, "get_project", { id: kept.id })).tasks).toEqual([]);
    // What went keeps its words and only the links inside the unit.
    const arrived = value(await to.call(hand, "get_entry", { id: entry.id }));
    expect(arrived.words).toBe(words);
    expect(arrived.links).toEqual([]);
    expect(arrived.follow_up_to).toBeNull();
    expect(arrived.standing).toBe(false);
    const wateringThere = value(await to.call(hand, "get_task", { id: water.id }));
    expect(wateringThere.state).toMatchObject({
      is: "open",
      waiting: [{ on: { kind: "task", id: mow.id } }],
    });
    const mowingThere = value(await to.call(hand, "get_task", { id: mow.id }));
    expect(mowingThere.project).toBeNull();
    expect(mowingThere.state).toMatchObject({ is: "open", delegated: null });
    // Nothing is made or matched by name in the Context moved to.
    expect(value(await to.call(hand, "list_persons", {})).items).toEqual([]);
    expect(value(await to.call(hand, "list_projects", {})).items).toEqual([]);
    expect(value(await to.call(hand, "list_entries", { standing: true })).items).toEqual([]);
  });

  test("a Project moves with its unit, and nothing in the Context moved to is matched to it by name", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const name = marked("Move house");
    atOnce(await to.call(hand, "create_project", { name }));
    const project = atOnce(await from.call(hand, "create_project", { name })).record;
    const entry = await anEntry(from, marked("Plan"), { tasks: [marked("Boxes")] });
    const boxes = entry.tasks[0] as Task;
    atOnce(await from.call(hand, "move_task", { id: boxes.id, project_id: project.id }));
    atOnce(await from.call(hand, "finish_project", { id: project.id }));
    const reference = await anEntry(from, marked("Plan it"), {
      links: [{ to: { kind: "project", id: project.id } }],
    });

    value(await move(deployment, work.id, home.id, from, { kind: "project", id: project.id }));

    const there = value(await to.call(hand, "get_project", { id: project.id }));
    expect(there.state).toMatchObject({ is: "finished" });
    expect(ids(there.tasks)).toEqual([boxes.id]);
    expect(value(await to.call(hand, "list_projects", {})).items).toHaveLength(2);
    expect(value(await from.call(hand, "get_entry", { id: reference.id })).links).toEqual([]);
    expect(await from.call(hand, "get_project", { id: project.id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("a Held Change on an Entry that goes lapses, by rule", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Mine"));
    const held = left(
      await from.call(agent, "edit_entry", { id: entry.id, words: marked("Theirs"), version: 0 }),
    );

    const moved = value(
      await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }),
    );

    expect(moved.effects).toContainEqual(
      expect.objectContaining({
        kind: "held_change",
        id: held.record.id,
        what: "deleted",
        by: "rule",
      }),
    );
    expect(value(await from.call(hand, "list_held_changes", {})).items).toEqual([]);
  });

  test("a record in the Trash cannot be moved, and while a Task from an Entry that would go is in the Trash the move is refused", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const deleted = await anEntry(from, marked("Gone"));
    value(await from.call(hand, "delete_entry", { id: deleted.id }));
    const entry = await anEntry(from, marked("Garden"), {
      tasks: [marked("Water"), marked("Mow")],
    });
    const mow = entry.tasks[1] as Task;
    const shown = await unitOf(from, "entry", entry.id);
    value(await from.call(hand, "delete_task", { id: mow.id }));

    expect(
      await deployment.call(hand, "move_record", {
        from: work.id,
        to: home.id,
        record: { kind: "entry", id: deleted.id },
        unit: [deleted.id],
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    const refused = await deployment.call(hand, "move_record", {
      from: work.id,
      to: home.id,
      record: { kind: "entry", id: entry.id },
      unit: ids(shown.unit.filter(({ id }) => id !== mow.id)),
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "task", id: mow.id }] },
    });
    // Restored, it moves with its Entry.
    value(await from.call(hand, "restore", { id: mow.id }));
    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));
    expect(ids(value(await to.call(hand, "get_entry", { id: entry.id })).tasks)).toEqual(
      ids(entry.tasks),
    );
  });

  test("a dormant link to a moved record is dropped: what is in the Trash comes back without it", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), { tasks: [marked("Water")] });
    const water = entry.tasks[0] as Task;
    const project = atOnce(
      await from.call(hand, "create_project", { name: marked("Yard") }),
    ).record;
    const plan = await anEntry(from, marked("Plan"), { tasks: [marked("Dig")] });
    const dig = plan.tasks[0] as Task;
    atOnce(await from.call(hand, "move_task", { id: dig.id, project_id: project.id }));
    const followUp = await anEntry(from, marked("Later"), { follow_up_to: entry.id });
    const referring = await anEntry(from, marked("About it"), {
      links: [{ to: { kind: "task", id: water.id } }],
    });
    for (const id of [followUp.id, referring.id]) {
      value(await from.call(hand, "delete_entry", { id }));
    }
    value(await from.call(hand, "delete_task", { id: dig.id }));

    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));
    value(await move(deployment, work.id, home.id, from, { kind: "project", id: project.id }));

    for (const id of [followUp.id, referring.id, dig.id]) {
      value(await from.call(hand, "restore", { id }));
    }
    expect(value(await from.call(hand, "get_entry", { id: followUp.id })).follow_up_to).toBeNull();
    expect(value(await from.call(hand, "get_entry", { id: referring.id })).links).toEqual([]);
    expect(value(await from.call(hand, "get_task", { id: dig.id })).project).toBeNull();
  });

  test("what would move must be what the person was shown: changed since, the move is refused with nothing moved", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    const shown = await unitOf(from, "entry", entry.id);
    await anEntry(from, marked("Later"), { follow_up_to: entry.id });

    expect(
      await deployment.call(hand, "move_record", {
        from: work.id,
        to: home.id,
        record: { kind: "entry", id: entry.id },
        unit: ids(shown.unit),
      }),
    ).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(value(await to.call(hand, "list_entries", {})).items).toEqual([]);
  });

  test("a move into a Context whose object is stuck on an upgrade is refused, with nothing moved", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    stickContext(home.id);

    expect(
      await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }),
    ).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "context", id: home.id, summary: "Home" }] },
    });
    expect(value(await from.call(hand, "get_entry", { id: entry.id })).id).toBe(entry.id);
  });

  test("a Context retired, unknown or the same one is not a place to move to or from", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    const third = value(
      await deployment.call(hand, "create_context", {
        name: "Old",
        time_zone: "UTC",
        accent: "rust",
      }),
    ).record;
    value(await deployment.call(hand, "retire_context", { id: third.id }));
    const asked = { record: { kind: "entry", id: entry.id }, unit: [entry.id] };

    for (const [fromId, toId, code] of [
      [work.id, third.id, "not_found"],
      [work.id, "no-such-context", "not_found"],
      [third.id, home.id, "not_found"],
      [work.id, work.id, "invalid_input"],
    ] as const) {
      expect(
        await deployment.call(hand, "move_record", { ...asked, from: fromId, to: toId }),
      ).toMatchObject({ ok: false, error: { code } });
    }
  });

  test("only the person's hand moves a record", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    for (const caller of everyCaller.filter((each) => each.kind !== "hand")) {
      expect(
        await deployment.call(caller, "move_record", {
          from: work.id,
          to: home.id,
          record: { kind: "entry", id: entry.id },
          unit: [entry.id],
        }),
      ).toMatchObject({ ok: false, error: { code: "not_offered" } });
      expect(
        await from.call(caller, "get_move_unit", { kind: "entry", id: entry.id }),
      ).toMatchObject({ ok: false, error: { code: "not_offered" } });
    }
  });

  test("an answer lost once is asked again: the unit arrives once, its Effects reported", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    failMovesInto(home.id, 1, "after");

    const moved = value(
      await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }),
    );

    expect(moved.record.arrived).toBe(true);
    expect(ids(value(await to.call(hand, "list_entries", {})).items)).toEqual([entry.id]);
  });

  test("an interrupted move is in neither Context's view until the source's alarm finishes it", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    failMovesInto(home.id, 2, "before");

    const moved = value(
      await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }),
    );

    expect(moved.record.arrived).toBe(false);
    expect(moved.effects.every(({ what }) => what !== "made")).toBe(true);
    expect(value(await from.call(hand, "list_entries", {})).items).toEqual([]);
    expect(value(await to.call(hand, "list_entries", {})).items).toEqual([]);

    deployment.advance(10 * 60 * 1000);
    await from.fireAlarm();

    expect(ids(value(await to.call(hand, "list_entries", {})).items)).toEqual([entry.id]);
    const { items } = value(await to.call(hand, "list_changes", {}));
    // Logged when it arrived there, as every change is.
    expect(items).toMatchObject([
      {
        at: "2026-11-15T09:10:00.000Z",
        tool: "move_record",
        caller: { kind: "hand" },
        effects: [{ id: entry.id, what: "made" }],
      },
    ]);
    // Done with: a later alarm carries nothing again.
    await from.fireAlarm();
    expect(value(await to.call(hand, "list_changes", {})).items).toHaveLength(1);
  });

  test("a move whose answer is lost every time is carried again by the alarm and taken once", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    failMovesInto(home.id, 2, "after");
    const shown = await unitOf(from, "entry", entry.id);

    const moved = value(
      await deployment.callUnjudged(hand, "move_record", {
        from: work.id,
        to: home.id,
        record: { kind: "entry", id: entry.id },
        unit: ids(shown.unit),
      }),
    );
    expect(moved.record.arrived).toBe(false);

    await from.fireAlarm();

    expect(ids(value(await to.call(hand, "list_entries", {})).items)).toEqual([entry.id]);
    expect(value(await to.call(hand, "list_changes", {})).items).toHaveLength(1);
  });

  test("a source whose answer was lost, asked again, answers as it did and the unit arrives once", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), { tasks: [marked("Water")] });
    const shown = await unitOf(from, "entry", entry.id);
    const asked = { record: { kind: "entry" as const, id: entry.id }, unit: ids(shown.unit) };
    value(await deployment.beginMoveUnheard(work.id, { ...asked, to: home.id }));

    const moved = value(
      await deployment.call(hand, "move_record", { ...asked, from: work.id, to: home.id }),
    );

    expect(moved.record).toMatchObject({ record: { id: entry.id }, arrived: true });
    expect(ids(value(await to.call(hand, "list_entries", {})).items)).toEqual([entry.id]);
    expect(
      value(await from.call(hand, "list_changes", {})).items.filter(
        ({ tool }) => tool === "move_record",
      ),
    ).toHaveLength(1);
    await from.fireAlarm();
    expect(value(await to.call(hand, "list_changes", {})).items).toHaveLength(1);
  });

  test("two wakes at once bring a unit back once, each reading what the other did", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    failMovesInto(home.id, 2, "before");
    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));
    value(await deployment.call(hand, "retire_context", { id: home.id }));
    value(await deployment.call(hand, "delete_context", { id: home.id, name: "Home" }));

    await Promise.all([deployment.fireAlarmOf(work.id), deployment.fireAlarmOf(work.id)]);

    expect(ids(value(await from.call(hand, "list_entries", {})).items)).toEqual([entry.id]);
    const back = value(await from.call(hand, "list_changes", {})).items.filter(
      ({ tool, effects }) => tool === "move_record" && effects[0]?.what === "made",
    );
    expect(back).toHaveLength(1);
  });

  test("a unit whose Context was deleted before it arrived comes back to the Context it left", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), { tasks: [marked("Water")] });
    failMovesInto(home.id, 2, "before");
    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));
    value(await deployment.call(hand, "retire_context", { id: home.id }));
    value(await deployment.call(hand, "delete_context", { id: home.id, name: "Home" }));

    await from.fireAlarm();

    const back = value(await from.call(hand, "get_entry", { id: entry.id }));
    expect(ids(back.tasks)).toEqual(ids(entry.tasks));
    expect(value(await from.call(hand, "list_changes", {})).items.at(-1)).toMatchObject({
      tool: "move_record",
      effects: [
        { id: entry.id, what: "made", by: "rule" },
        { id: entry.tasks[0]?.id, what: "made", by: "rule" },
      ],
    });
  });

  test("a Context holding a unit on its way out cannot be deleted until it has arrived", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    failMovesInto(home.id, 2, "before");
    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));
    value(await deployment.call(hand, "retire_context", { id: work.id }));

    expect(
      await deployment.call(hand, "delete_context", { id: work.id, name: "Work" }),
    ).toMatchObject({ ok: false, error: { code: "refused" } });

    await deployment.fireAlarmOf(work.id);
    value(await deployment.call(hand, "delete_context", { id: work.id, name: "Work" }));
  });

  test("an Export holds a unit on its way out in the Context it left, and in no other list", async () => {
    const { deployment, work, home, from } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), { tasks: [marked("Water")] });
    failMovesInto(home.id, 2, "before");
    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));

    const made = value(await deployment.call(hand, "make_export", {}));

    const file = made.files.find(
      ({ content }) => "context" in content && content.context.id === work.id,
    )?.content;
    expect(file).toMatchObject({
      entries: [],
      tasks: [],
      moving: [
        {
          id: expect.any(String),
          to: home.id,
          at: "2026-11-15T09:00:00.000Z",
          entries: [{ id: entry.id, words: entry.words }],
          tasks: [{ id: entry.tasks[0]?.id, origin_entry: entry.id }],
          projects: [],
        },
      ],
    });
  });

  test("a record moved can be moved back, keeping its id", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), { tasks: [marked("Water")] });

    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));
    value(await move(deployment, home.id, work.id, to, { kind: "entry", id: entry.id }));

    expect(ids(value(await from.call(hand, "get_entry", { id: entry.id })).tasks)).toEqual(
      ids(entry.tasks),
    );
    expect(value(await to.call(hand, "list_entries", {})).items).toEqual([]);
  });

  test("a finish of a Task since moved, sent to the Context it left as an Unsent finish is, is refused", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"), { tasks: [marked("Water")] });
    const water = entry.tasks[0] as Task;
    value(await move(deployment, work.id, home.id, from, { kind: "entry", id: entry.id }));
    deployment.advance(DAY);

    expect(await from.call(hand, "finish_task", { id: water.id, key: "unsent-1" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(value(await to.call(hand, "get_task", { id: water.id })).state.is).toBe("open");
  });

  test("a key given again returns the first result and moves nothing twice", async () => {
    const { deployment, work, home, from, to } = await twoContexts();
    const entry = await anEntry(from, marked("Garden"));
    const asked = {
      from: work.id,
      to: home.id,
      record: { kind: "entry", id: entry.id },
      unit: [entry.id],
      key: "move-1",
    };

    const first = await deployment.call(hand, "move_record", asked);
    const again = await deployment.call(hand, "move_record", asked);

    expect(again).toEqual(first);
    expect(value(await to.call(hand, "list_changes", {})).items).toHaveLength(1);
  });
});
