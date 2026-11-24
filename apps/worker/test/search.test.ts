import type { SearchHit } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { setMeaningFailing } from "./meaning-fake.ts";
import { agent, atOnce, connection, DAY, everyCaller, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** What a search found, each hit as its kind and id, best first. */
/** Where a word stands in some text, as a match: wherever its marker put it. */
function matched(text: string, word: string) {
  const start = text.indexOf(word);
  return { start, end: start + word.length };
}

async function found(context: Context, input: Record<string, unknown>) {
  const results = value(await context.call(hand, "search", input));
  return results.items.map(({ kind, id }) => `${kind}:${id}`);
}

/** An Entry recorded by the person, with these words. */
async function anEntry(context: Context, words: string, input: Record<string, unknown> = {}) {
  return atOnce(await context.call(hand, "record_entry", { words, ...input })).record;
}

describe("search", () => {
  test("finds an Entry by its words as soon as it is saved, the same for every caller", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const words = marked("A budget to look at");
    const entry = await anEntry(context, words);
    await anEntry(context, marked("Nothing to do with money"));

    const answers = [];
    for (const caller of everyCaller) {
      answers.push(value(await context.call(caller, "search", { words: "budget" })));
    }

    const hit: SearchHit = {
      kind: "entry",
      id: entry.id,
      summary: words,
      at: "2026-11-15T09:00:00.000Z",
      author: { kind: "person" },
      excerpt: { text: words, matches: [matched(words, "budget")] },
    };
    for (const answer of answers)
      expect(answer).toEqual({ items: [hit], next_cursor: null, words_only: null });
  });

  test("finds Tasks, Projects and Persons by title or name, in one list with Entries, best first", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("Called the garden centre about the hedge"), {
      tasks: [{ title: marked("Trim the hedge") }],
    });
    const task = entry.tasks[0];
    const project = value(
      await context.call(hand, "create_project", { name: marked("Hedge") }),
    ).record;
    const person = value(
      await context.call(hand, "create_person", { name: marked("Hedge Fund Hal") }),
    ).record;
    await anEntry(context, marked("A walk in the park"));

    const results = value(await context.call(hand, "search", { words: "hedge" })).items;

    expect(results.map(({ kind, id }) => `${kind}:${id}`).sort()).toEqual(
      [
        `entry:${entry.id}`,
        `task:${task?.id}`,
        `project:${project.id}`,
        `person:${person.id}`,
      ].sort(),
    );
    // The fewer other words a record holds, the better it matches.
    expect(results[0]).toEqual({
      kind: "project",
      id: project.id,
      summary: project.name,
      at: project.at,
      excerpt: { text: project.name, matches: [matched(project.name, "Hedge")] },
      due_date: null,
      state: { is: "open", overdue: null },
      actionable_tasks: 0,
      no_open_task: true,
    });
    expect(results.find((hit) => hit.kind === "task")).toEqual({
      kind: "task",
      id: task?.id,
      summary: task?.title,
      at: task?.at,
      author: { kind: "person" },
      origin_entry: entry.id,
      excerpt: { text: task?.title, matches: [matched(task?.title ?? "", "hedge")] },
      due_date: null,
      defer_date: null,
      recurrence: null,
      state: {
        is: "open",
        actionable: true,
        waiting: null,
        delegated: null,
        deferred: null,
        overdue: null,
      },
    });
    // A Person found carries no state: a Person has none.
    expect(results.find((hit) => hit.kind === "person")).toEqual({
      kind: "person",
      id: person.id,
      summary: person.name,
      at: person.at,
      excerpt: { text: person.name, matches: [matched(person.name, "Hedge")] },
    });
  });

  test("a Task found carries its dates, Recurrence and state as get_task gives them, in every state", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const titles = {
      open: "Parcel open",
      finished: "Parcel finished",
      dropped: "Parcel dropped",
      waiting: "Parcel waiting",
      deferred: "Parcel deferred",
      delegated: "Parcel delegated",
      overdue: "Parcel overdue",
      recurring: "Parcel recurring",
    };
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Post office"),
        tasks: Object.values(titles).map((title) => ({ title: marked(title) })),
      }),
    );
    const [open, finished, dropped, waiting, deferred, delegated, overdue, recurring] =
      entry.tasks.map(({ id }) => id) as string[];
    const alice = value(
      await context.call(hand, "create_person", { name: marked("Alice Moreau") }),
    ).record;
    value(await context.call(hand, "finish_task", { id: finished }));
    value(await context.call(hand, "drop_task", { id: dropped }));
    value(await context.call(hand, "wait_on", { id: waiting, on: { kind: "task", id: open } }));
    value(await context.call(hand, "set_task_dates", { id: deferred, defer_date: "2026-11-20" }));
    value(await context.call(hand, "delegate_task", { id: delegated, person_id: alice.id }));
    value(await context.call(hand, "set_task_dates", { id: overdue, due_date: "2026-11-10" }));
    value(await context.call(hand, "set_task_dates", { id: recurring, due_date: "2026-11-16" }));
    value(
      await context.call(hand, "set_recurrence", {
        id: recurring,
        recurrence: { kind: "weeks", every: 1, on: ["monday"] },
      }),
    );

    const hits = new Map(
      value(await context.call(hand, "search", { words: "parcel" })).items.map((hit) => [
        hit.id,
        hit,
      ]),
    );

    for (const id of [open, finished, dropped, waiting, deferred, delegated, overdue, recurring]) {
      const task = value(await context.call(hand, "get_task", { id }));
      expect(hits.get(id as string)).toMatchObject({
        kind: "task",
        due_date: task.due_date,
        defer_date: task.defer_date,
        recurrence: task.recurrence,
        state: task.state,
      });
    }
    expect(hits.get(finished as string)).toMatchObject({ state: { is: "finished" } });
    expect(hits.get(dropped as string)).toMatchObject({ state: { is: "dropped" } });
    expect(hits.get(waiting as string)).toMatchObject({
      state: { is: "open", actionable: false, waiting: [{ on: { kind: "task", id: open } }] },
    });
    expect(hits.get(deferred as string)).toMatchObject({
      state: { deferred: { until: "2026-11-20" } },
    });
    expect(hits.get(delegated as string)).toMatchObject({
      state: { delegated: { to: { id: alice.id, name: alice.name } } },
    });
    expect(hits.get(overdue as string)).toMatchObject({
      due_date: "2026-11-10",
      state: { overdue: { since: "2026-11-11" } },
    });
    expect(hits.get(recurring as string)).toMatchObject({
      due_date: "2026-11-16",
      recurrence: { kind: "weeks", every: 1, on: ["monday"] },
    });
  });

  test("a Project found carries its Due Date and state as get_project gives them, and its count of actionable Tasks", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const project = async (name: string, due_date?: string) =>
      value(await context.call(hand, "create_project", { name: marked(name), due_date })).record;
    const busy = await project("Shed busy");
    const late = await project("Shed late", "2026-11-12");
    const finished = await project("Shed finished");
    const dropped = await project("Shed dropped");
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Shed jobs"),
        tasks: [{ title: marked("Paint") }, { title: marked("Roof") }, { title: marked("Door") }],
      }),
    );
    const [paint, roof, door] = entry.tasks.map(({ id }) => id) as string[];
    for (const id of [paint, roof, door]) {
      value(await context.call(hand, "move_task", { id, project_id: busy.id }));
    }
    value(await context.call(hand, "set_task_dates", { id: door, defer_date: "2026-11-30" }));
    value(await context.call(hand, "finish_project", { id: finished.id }));
    value(await context.call(hand, "drop_project", { id: dropped.id }));

    const hits = new Map(
      value(await context.call(hand, "search", { words: "shed" })).items.map((hit) => [
        hit.id,
        hit,
      ]),
    );

    for (const { id } of [busy, late, finished, dropped]) {
      const read = value(await context.call(hand, "get_project", { id }));
      expect(hits.get(id)).toMatchObject({
        kind: "project",
        due_date: read.due_date,
        state: read.state,
      });
    }
    const attention = value(await context.call(hand, "view_attention", {})).projects;
    for (const { project: read, actionable_tasks, no_open_task } of attention) {
      expect(hits.get(read.id)).toMatchObject({ actionable_tasks, no_open_task });
    }
    expect(hits.get(busy.id)).toMatchObject({ actionable_tasks: 2, no_open_task: false });
    expect(hits.get(late.id)).toMatchObject({
      state: { is: "open", overdue: { since: "2026-11-13" } },
      actionable_tasks: 0,
      no_open_task: true,
    });
    expect(hits.get(finished.id)).toMatchObject({ state: { is: "finished" } });
    expect(hits.get(dropped.id)).toMatchObject({ state: { is: "dropped" } });
  });

  test("follows an Entry's words as they change, and never searches an earlier Version", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("Meet the plumber on Monday"));

    atOnce(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("Meet the electrician on Monday"),
        version: entry.version,
      }),
    );

    expect(await found(context, { words: "plumber" })).toEqual([]);
    expect(await found(context, { words: "electrician" })).toEqual([`entry:${entry.id}`]);
  });

  test("follows a Task's title, a Project's name and a Person's name as they change", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("Plans"), {
      tasks: [{ title: marked("Book a van") }],
    });
    const task = entry.tasks[0];
    const project = value(
      await context.call(hand, "create_project", { name: marked("Move") }),
    ).record;
    const person = value(await context.call(hand, "create_person", { name: marked("Sam") })).record;

    value(await context.call(hand, "rename_task", { id: task?.id, title: marked("Book a lorry") }));
    value(await context.call(hand, "rename_project", { id: project.id, name: marked("Removal") }));
    value(await context.call(hand, "rename_person", { id: person.id, name: marked("Samira") }));

    for (const gone of ["van", "move", "sam"]) {
      expect(await found(context, { words: `${gone} ` })).toEqual([]);
    }
    expect(await found(context, { words: "lorry" })).toEqual([`task:${task?.id}`]);
    expect(await found(context, { words: "removal" })).toEqual([`project:${project.id}`]);
    expect(await found(context, { words: "samira" })).toEqual([`person:${person.id}`]);
  });

  test("never finds what is in the Trash: a deleted Entry and its Tasks leave at once and come back on restore", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("Renew the passport"), {
      tasks: [{ title: marked("Passport photos") }],
    });
    const task = entry.tasks[0];
    const both = [`entry:${entry.id}`, `task:${task?.id}`].sort();

    atOnce(await context.call(hand, "delete_entry", { id: entry.id }));
    expect(await found(context, { words: "passport" })).toEqual([]);

    value(await context.call(hand, "restore", { id: entry.id }));
    expect((await found(context, { words: "passport" })).sort()).toEqual(both);

    atOnce(await context.call(hand, "delete_entry", { id: entry.id }));
    value(await context.call(hand, "remove_for_good", { id: entry.id }));
    expect(await found(context, { words: "passport" })).toEqual([]);
  });

  test("never finds a Task, Project or Person in the Trash", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("Notes"), {
      tasks: [{ title: marked("Call Quentin") }],
    });
    const project = value(
      await context.call(hand, "create_project", { name: marked("Quentin's wedding") }),
    ).record;
    const person = value(
      await context.call(hand, "create_person", { name: marked("Quentin") }),
    ).record;

    value(await context.call(hand, "delete_task", { id: entry.tasks[0]?.id }));
    value(await context.call(hand, "delete_project", { id: project.id }));
    value(await context.call(hand, "delete_person", { id: person.id }));

    expect(await found(context, { words: "quentin" })).toEqual([]);
  });

  test("sets case and accents aside, and needs every word given", async () => {
    const context = newContext();
    const cafe = await anEntry(context, marked("Coffee with Zoë at the Café Noir"));
    await anEntry(context, marked("Coffee alone"));

    expect(await found(context, { words: "ZOE cafe" })).toEqual([`entry:${cafe.id}`]);
    expect(await found(context, { words: "café zoë coffee" })).toEqual([`entry:${cafe.id}`]);
    expect(await found(context, { words: "coffee tea" })).toEqual([]);
  });

  test("finds the words the last one begins while nothing follows it, as while it is typed", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked("Insurance renewal due"));

    expect(await found(context, { words: "renewal insur" })).toEqual([`entry:${entry.id}`]);
    expect(await found(context, { words: "insur renewal" })).toEqual([]);
    expect(await found(context, { words: "insur " })).toEqual([]);
  });

  test("reads what is typed as words only, never as a query language", async () => {
    const context = newContext();
    const entry = await anEntry(context, marked('Said "no" to the NEAR offer, AND the other one'));

    for (const words of [
      '"no"',
      "NEAR(offer",
      "near and OTHER",
      "offer AND",
      "said:offer",
      "-offer",
      "no*",
      "^said",
    ]) {
      expect(await found(context, { words }), words).toEqual([`entry:${entry.id}`]);
    }
    expect(await found(context, { words: "?!" })).toEqual([]);
    expect(await context.call(hand, "search", { words: "  " })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  test("narrows to records made between two days in the Context's time zone, both included", async () => {
    // 10:30 UTC on the 15th is 23:30 there in Auckland, 13 hours ahead.
    const context = newContext("2026-11-15T10:30:00.000Z", {
      name: "Personal",
      time_zone: "Pacific/Auckland",
    });
    const fifteenth = await anEntry(context, marked("Tide tables, late on the 15th"));
    context.advance(60 * 60 * 1000);
    const sixteenth = await anEntry(context, marked("Tide tables, early on the 16th"));
    context.advance(DAY);
    const seventeenth = await anEntry(context, marked("Tide tables on the 17th"));
    context.advance(DAY);
    const project = value(
      await context.call(hand, "create_project", { name: marked("Tide") }),
    ).record;

    expect(
      (await found(context, { words: "tide", from: "2026-11-16", to: "2026-11-17" })).sort(),
    ).toEqual([`entry:${sixteenth.id}`, `entry:${seventeenth.id}`].sort());
    expect(await found(context, { words: "tide", to: "2026-11-15" })).toEqual([
      `entry:${fifteenth.id}`,
    ]);
    expect(await found(context, { words: "tide", from: "2026-11-18" })).toEqual([
      `project:${project.id}`,
    ]);
    expect(
      await context.call(hand, "search", { words: "tide", from: "2026-11-17", to: "2026-11-16" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("a day summer time starts at midnight begins when that day's clock first reads it", async () => {
    // In Santiago, 6 September 2026 has no midnight: the clocks go from 23:59 on the 5th to 01:00.
    // 03:30 UTC on the 6th is 23:30 on the 5th there.
    const context = newContext("2026-09-06T03:30:00.000Z", {
      name: "Personal",
      time_zone: "America/Santiago",
    });
    const fifth = await anEntry(context, marked("Lanterns lit late on the 5th"));

    expect(await found(context, { words: "lanterns", to: "2026-09-05" })).toEqual([
      `entry:${fifth.id}`,
    ]);
    expect(await found(context, { words: "lanterns", from: "2026-09-06" })).toEqual([]);
  });

  test("narrows to a Project: the Tasks in it and the Entries that Reference it or hold a Task in it", async () => {
    const context = newContext();
    const kitchen = value(
      await context.call(hand, "create_project", { name: marked("Kitchen") }),
    ).record;
    const garden = value(
      await context.call(hand, "create_project", { name: marked("Garden") }),
    ).record;
    const referencing = await anEntry(context, marked("Tiles chosen"), {
      links: [{ to: { kind: "project", id: kitchen.id } }],
    });
    const holding = await anEntry(context, marked("Tiles to order"), {
      tasks: [{ title: marked("Order tiles") }],
    });
    const task = holding.tasks[0];
    value(await context.call(hand, "move_task", { id: task?.id, project_id: kitchen.id }));
    await anEntry(context, marked("Tiles for the garden path"), {
      links: [{ to: { kind: "project", id: garden.id } }],
    });
    value(await context.call(hand, "create_project", { name: marked("Tiles") }));

    expect((await found(context, { words: "tiles", project_id: kitchen.id })).sort()).toEqual(
      [`entry:${referencing.id}`, `entry:${holding.id}`, `task:${task?.id}`].sort(),
    );
  });

  test("narrows to a Person: the Entries that Mention them and the Tasks ever Delegated to them", async () => {
    const context = newContext();
    const ali = value(await context.call(hand, "create_person", { name: marked("Ali") })).record;
    const mentioning = await anEntry(context, marked("Spoke about the roof"), {
      links: [{ to: { kind: "person", id: ali.id } }],
    });
    const holding = await anEntry(context, marked("Roof jobs"), {
      tasks: [{ title: marked("Fix the roof") }, { title: marked("Clear the roof gutter") }],
    });
    const [delegated, kept] = holding.tasks;
    value(await context.call(hand, "delegate_task", { id: delegated?.id, person_id: ali.id }));
    value(await context.call(hand, "finish_task", { id: delegated?.id }));
    value(await context.call(hand, "create_person", { name: marked("Roofer Rob") }));
    expect(kept).toBeDefined();

    expect((await found(context, { words: "roof", person_id: ali.id })).sort()).toEqual(
      [`entry:${mentioning.id}`, `task:${delegated?.id}`].sort(),
    );
  });

  test("narrows to an Author: the Entries and Tasks they made, a Connection by its name", async () => {
    const context = newContext();
    const mine = await anEntry(context, marked("Ferry times"));
    const agents = atOnce(
      await context.call(agent, "record_entry", {
        words: marked("Ferry booked"),
        tasks: [{ title: marked("Print the ferry tickets") }],
      }),
    ).record;
    const connections = atOnce(
      await context.call(connection, "record_entry", { words: marked("Ferry strike news") }),
    ).record;
    value(await context.call(hand, "create_project", { name: marked("Ferry") }));

    expect(await found(context, { words: "ferry", author: { kind: "person" } })).toEqual([
      `entry:${mine.id}`,
    ]);
    expect((await found(context, { words: "ferry", author: { kind: "agent" } })).sort()).toEqual(
      [`entry:${agents.id}`, `task:${agents.tasks[0]?.id}`].sort(),
    );
    for (const author of [{ kind: "connection" }, { kind: "connection", name: connection.name }]) {
      expect(await found(context, { words: "ferry", author })).toEqual([`entry:${connections.id}`]);
    }
    expect(
      await found(context, { words: "ferry", author: { kind: "connection", name: "Another" } }),
    ).toEqual([]);
  });

  test("a Project or Person to narrow to that is not in this Context, or is in the Trash, is not found", async () => {
    const context = newContext();
    const project = value(
      await context.call(hand, "create_project", { name: marked("Gone") }),
    ).record;
    value(await context.call(hand, "delete_project", { id: project.id }));

    for (const input of [
      { project_id: project.id },
      { project_id: "no-such-project" },
      { person_id: "no-such-person" },
    ]) {
      expect(await context.call(hand, "search", { words: "gone", ...input })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });

  test("with no words, a Project lists every Entry and Task it holds, newest first, each with its first words", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const kitchen = value(
      await context.call(hand, "create_project", { name: marked("Kitchen") }),
    ).record;
    const referencing = await anEntry(context, marked("Tiles chosen"), {
      links: [{ to: { kind: "project", id: kitchen.id } }],
    });
    context.advance(60 * 1000);
    const holding = await anEntry(context, marked("Things to order"));
    await anEntry(context, marked("A walk in the park"));
    context.advance(60 * 1000);
    const task = value(
      await context.call(hand, "add_task", { entry_id: holding.id, title: marked("Order tiles") }),
    ).record;
    value(await context.call(hand, "move_task", { id: task.id, project_id: kitchen.id }));
    context.advance(60 * 1000);
    const long = Array.from({ length: 20 }, (_, at) => `word${at}`).join("\n");
    const latest = await anEntry(context, marked(`Cabinets\n\n${long}`), {
      links: [{ to: { kind: "project", id: kitchen.id } }],
    });
    value(await context.call(hand, "create_person", { name: marked("Kitchen Kim") }));

    const results = value(await context.call(hand, "search", { project_id: kitchen.id }));

    expect(results.items.map(({ kind, id, excerpt }) => ({ kind, id, excerpt }))).toEqual([
      {
        kind: "entry",
        id: latest.id,
        excerpt: {
          text: `${latest.words.split(/\s+/u).slice(0, 16).join(" ")}…`,
          matches: [],
        },
      },
      { kind: "task", id: task.id, excerpt: { text: task.title, matches: [] } },
      { kind: "entry", id: holding.id, excerpt: { text: holding.words, matches: [] } },
      { kind: "entry", id: referencing.id, excerpt: { text: referencing.words, matches: [] } },
    ]);
    expect(results.items.at(-1)).toEqual({
      kind: "entry",
      id: referencing.id,
      summary: referencing.words,
      at: "2026-11-15T09:00:00.000Z",
      author: { kind: "person" },
      excerpt: { text: referencing.words, matches: [] },
    });
    expect(results.next_cursor).toBeNull();
    expect(results.words_only).toBeNull();
  });

  test("with no words, a Person or an Author lists what it holds, and meaning is not asked", async () => {
    const context = newContext();
    const ali = value(await context.call(hand, "create_person", { name: marked("Ali") })).record;
    const mentioning = await anEntry(context, marked("Spoke with her"), {
      links: [{ to: { kind: "person", id: ali.id } }],
    });
    context.advance(60 * 1000);
    const agents = atOnce(
      await context.call(agent, "record_entry", { words: marked("Booked it") }),
    ).record;
    context.advance(60 * 1000);
    const delegated = value(
      await context.call(agent, "add_task", {
        entry_id: agents.id,
        title: marked("Ask Ali about it"),
      }),
    ).record;
    value(await context.call(hand, "delegate_task", { id: delegated.id, person_id: ali.id }));
    value(await context.call(hand, "create_project", { name: marked("Ali's move") }));
    setMeaningFailing(true);

    for (const caller of everyCaller) {
      expect(
        value(await context.call(caller, "search", { person_id: ali.id, words: " " })),
      ).toMatchObject({
        items: [
          { kind: "task", id: delegated.id },
          { kind: "entry", id: mentioning.id },
        ],
        next_cursor: null,
        words_only: null,
      });
    }
    expect(await found(context, { author: { kind: "agent" } })).toEqual([
      `task:${delegated.id}`,
      `entry:${agents.id}`,
    ]);
    expect(await found(context, { author: { kind: "person" } })).toEqual([
      `entry:${mentioning.id}`,
    ]);
  });

  test("with no words, a range of days lists every Entry and Task made in it, in the Context's time zone", async () => {
    // 10:30 UTC on the 15th is 23:30 there in Auckland, 13 hours ahead.
    const context = newContext("2026-11-15T10:30:00.000Z", {
      name: "Personal",
      time_zone: "Pacific/Auckland",
    });
    const fifteenth = await anEntry(context, marked("Late on the 15th"));
    context.advance(60 * 60 * 1000);
    const sixteenth = await anEntry(context, marked("Early on the 16th"));
    context.advance(60 * 1000);
    const task = value(
      await context.call(hand, "add_task", { entry_id: sixteenth.id, title: marked("Call back") }),
    ).record;
    value(await context.call(hand, "create_project", { name: marked("Made on the 16th") }));
    value(await context.call(hand, "create_person", { name: marked("Met on the 16th") }));
    const trashed = await anEntry(context, marked("Deleted on the 16th"));
    atOnce(await context.call(hand, "delete_entry", { id: trashed.id }));
    context.advance(DAY);
    const long = Array.from({ length: 20 }, (_, at) => `word${at}`).join("\n");
    const seventeenth = await anEntry(context, marked(`On the 17th\n\n${long}`));
    context.advance(DAY);
    const eighteenth = await anEntry(context, marked("On the 18th"));
    setMeaningFailing(true);

    for (const caller of everyCaller) {
      const results = value(
        await context.call(caller, "search", { from: "2026-11-16", to: "2026-11-17" }),
      );
      expect(results.items.map(({ kind, id, excerpt }) => ({ kind, id, excerpt }))).toEqual([
        {
          kind: "entry",
          id: seventeenth.id,
          excerpt: {
            text: `${seventeenth.words.split(/\s+/u).slice(0, 16).join(" ")}…`,
            matches: [],
          },
        },
        { kind: "task", id: task.id, excerpt: { text: task.title, matches: [] } },
        { kind: "entry", id: sixteenth.id, excerpt: { text: sixteenth.words, matches: [] } },
      ]);
      expect(results.next_cursor).toBeNull();
      expect(results.words_only).toBeNull();
    }
    expect(await found(context, { from: "2026-11-17" })).toEqual([
      `entry:${eighteenth.id}`,
      `entry:${seventeenth.id}`,
    ]);
    expect(await found(context, { to: "2026-11-15", words: " " })).toEqual([
      `entry:${fifteenth.id}`,
    ]);
  });

  test("with no words and no narrowing at all, is refused, as is a range whose start is after its end", async () => {
    const context = newContext();
    await anEntry(context, marked("Anything at all"));

    for (const input of [{}, { words: "" }, { words: "  " }]) {
      const refused = await context.call(hand, "search", input);
      expect(refused).toMatchObject({ ok: false, error: { code: "invalid_input" } });
      expect(refused.ok ? "" : refused.error.message).toContain("A search needs words.");
    }
    const backwards = await context.call(hand, "search", { from: "2026-11-17", to: "2026-11-16" });
    expect(backwards).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(backwards.ok ? "" : backwards.error.message).toContain("`from` is a day on or before");
  });

  test("with no words, gives 50 to a page, newest first, and a cursor to the next", async () => {
    // Made from 09:00 on the 15th in UTC, so the 15th onward holds every one.
    const context = newContext("2026-11-15T09:00:00.000Z", {
      name: "Personal",
      time_zone: "UTC",
    });
    const made: string[] = [];
    for (let receipt = 0; receipt < 53; receipt++) {
      made.unshift(`entry:${(await anEntry(context, marked("Kept"))).id}`);
      context.advance(60 * 1000);
    }

    for (const narrowing of [{ author: { kind: "person" } }, { from: "2026-11-15" }]) {
      const first = value(await context.call(hand, "search", narrowing));
      const second = value(
        await context.call(hand, "search", { ...narrowing, cursor: first.next_cursor }),
      );

      expect(first.items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(made.slice(0, 50));
      expect(second.items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(made.slice(50));
      expect(second.next_cursor).toBeNull();
    }
  });

  test("gives 50 to a page, newest first among equal matches, and a cursor to the next", async () => {
    const context = newContext();
    const made: string[] = [];
    for (let receipt = 0; receipt < 53; receipt++) {
      made.unshift(`entry:${(await anEntry(context, marked("Receipt kept"))).id}`);
      context.advance(60 * 1000);
    }

    const first = value(await context.call(hand, "search", { words: "receipt" }));
    const second = value(
      await context.call(hand, "search", { words: "receipt", cursor: first.next_cursor }),
    );

    expect(first.items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(made.slice(0, 50));
    expect(second).toEqual({ items: expect.any(Array), next_cursor: null, words_only: null });
    expect(second.items.map(({ kind, id }) => `${kind}:${id}`)).toEqual(made.slice(50));
    const otherList = value(await context.call(hand, "list_entries", {})).next_cursor;
    expect(
      await context.call(hand, "search", { words: "receipt", cursor: otherList }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("gives an Entry's excerpt on one line, cut around what matched", async () => {
    const context = newContext();
    const before = Array.from({ length: 30 }, (_, at) => `before${at}`).join(" ");
    const after = Array.from({ length: 30 }, (_, at) => `after${at}`).join("\n");
    await anEntry(context, marked(`# Notes\n\n${before}\n\n**Anchovy** paste\n${after}`));

    const [hit] = value(await context.call(hand, "search", { words: "anchovy" })).items;

    const excerpt = hit?.excerpt ?? { text: "", matches: [] };
    expect(excerpt.text).toMatch(/^….* \*\*Anchovy\*\* paste .*…$/);
    expect(excerpt.text).not.toMatch(/\s{2}|\n/);
    expect(excerpt.text.split(" ").length).toBeLessThanOrEqual(16);
    expect(excerpt.matches.map(({ start, end }) => excerpt.text.slice(start, end))).toEqual([
      "Anchovy",
    ]);
  });

  describe("cuts an Entry's excerpt around the first place a longer word given matches", () => {
    test("shows the longer word where short words fill the start", async () => {
      const context = newContext();
      const early =
        "Surface one item in Attention only when a decision is needed, and keep the run";
      const late = "details in a log for later, with nothing else in it until the end";
      await anEntry(context, marked(`${early} ${late}`));

      const [hit] = value(await context.call(hand, "search", { words: "log in" })).items;

      const text = hit?.excerpt.text ?? "";
      expect(text).toMatch(/ a log for later, /);
      expect(spansOf(hit)).toEqual([{ text: "log", start: text.indexOf("log") }]);
    });

    test("keeps as many words as an excerpt does, on one line, marked as cut only where the words go on", async () => {
      const context = newContext();
      const filler = (name: string) =>
        Array.from({ length: 20 }, (_, at) => `${name}${at} in`).join("\n");
      const atStart = await anEntry(context, marked(`Ledger in hand\n\n${filler("first")}`));
      const atEnd = await anEntry(
        context,
        marked(`${filler("second")}\n\nthe ledger   in the end`),
      );
      const inMiddle = await anEntry(
        context,
        marked(`${filler("third")} ledger ${filler("fourth")}`),
      );

      const results = value(await context.call(hand, "search", { words: "ledger in" })).items;
      const excerpt = (id: string) => results.find((hit) => hit.id === id)?.excerpt.text ?? "";

      const [itsMarker] = atStart.words.split(" ");
      expect(excerpt(atStart.id)).toBe(
        `${itsMarker} Ledger in hand first0 in first1 in first2 in first3 in first4 in first5 in…`,
      );
      expect(excerpt(atEnd.id)).toBe(
        "…in second15 in second16 in second17 in second18 in second19 in the ledger in the end",
      );
      expect(excerpt(inMiddle.id)).toBe(
        "…third18 in third19 in ledger fourth0 in fourth1 in fourth2 in fourth3 in fourth4 in fourth5…",
      );
    });

    test("cuts the same around a match in another case or accents, or one the last word begins", async () => {
      const context = newContext();
      const before = Array.from({ length: 20 }, (_, at) => `w${at} in`).join(" ");
      const around = (word: string) => `${before} ${word} after in it`;
      // Words no marker holds: its hex digits could begin a word given last, as "caf" would.
      const exact = await anEntry(context, marked(around("rose")));
      const accented = await anEntry(context, marked(around("ROSÉ")));
      const begun = await anEntry(context, marked(around("roseraie")));
      const cut = async (words: string, id: string) => {
        const { items } = value(await context.call(hand, "search", { words }));
        const hit = items.find((each) => each.id === id);
        return { text: hit?.excerpt.text, spans: spansOf(hit).map(({ text }) => text) };
      };

      const around16 = (word: string) =>
        `…w14 in w15 in w16 in w17 in w18 in w19 in ${word} after in it`;
      expect(await cut("rose in", exact.id)).toEqual({
        text: around16("rose"),
        spans: ["in", "rose"],
      });
      expect(await cut("Rosé in", accented.id)).toEqual({
        text: around16("ROSÉ"),
        spans: ["in", "ROSÉ"],
      });
      expect(await cut("in ros", begun.id)).toEqual({
        text: around16("roseraie"),
        spans: ["in", "roseraie"],
      });
    });

    test("leaves the cut to SQLite when every word given is short", async () => {
      const context = newContext();
      const filler = (name: string) => Array.from({ length: 20 }, (_, at) => `${name}${at}`);
      const entry = await anEntry(
        context,
        marked([...filler("a"), "to", "go", ...filler("b"), "to", "do", ...filler("c")].join(" ")),
      );

      const [hit] = value(await context.call(hand, "search", { words: "to do" })).items;

      expect(hit?.id).toBe(entry.id);
      expect(hit?.excerpt.text).toBe("…b13 b14 b15 b16 b17 b18 b19 to do c0 c1 c2 c3 c4 c5 c6…");
    });
  });

  describe("marks a short word given only beside a longer word's mark", () => {
    test("marks the phrase, not every place the short word stands", async () => {
      const context = newContext();
      const words = marked("Fix the bug allowing any user in the domain to log in");
      await anEntry(context, words);

      const [hit] = value(await context.call(hand, "search", { words: "log in" })).items;

      const text = hit?.excerpt.text ?? "";
      expect(text).toMatch(/any user in the domain to log in$/);
      expect(spansOf(hit)).toEqual([
        { text: "log", start: text.indexOf("log in") },
        { text: "in", start: text.indexOf("log in") + 4 },
      ]);
    });

    test("drops a short last word's mark on a word it begins, outside a run", async () => {
      const context = newContext();
      await anEntry(context, marked("Look inside the shed, then log in"));

      const [hit] = value(await context.call(hand, "search", { words: "log in" })).items;

      expect(spansOf(hit).map(({ text }) => text)).toEqual(["log", "in"]);
    });

    test("sets case and accents aside in telling a short word's mark", async () => {
      const context = newContext();
      await anEntry(context, marked("In town, the CAFÉ in the square"));

      const [hit] = value(await context.call(hand, "search", { words: "Cafe in" })).items;

      expect(spansOf(hit).map(({ text }) => text)).toEqual(["CAFÉ", "in"]);
    });

    test("keeps every mark of a long word given, wherever it falls", async () => {
      const context = newContext();
      await anEntry(context, marked("Read the log in the morning, then log in"));

      const [hit] = value(await context.call(hand, "search", { words: "log in" })).items;

      expect(spansOf(hit).map(({ text }) => text)).toEqual(["log", "in", "log", "in"]);
      const text = hit?.excerpt.text ?? "";
      expect(spansOf(hit).map(({ start }) => start)).toEqual([
        text.indexOf("log in the"),
        text.indexOf("in the"),
        text.lastIndexOf("log in"),
        text.lastIndexOf("in"),
      ]);
    });

    test("keeps every mark when every word given is short", async () => {
      const context = newContext();
      await anEntry(context, marked("Al and Alma"));
      await anEntry(context, marked("A list to do, and the rest to do later"));

      const al = value(await context.call(hand, "search", { words: "Al" })).items;
      const toDo = value(await context.call(hand, "search", { words: "to do" })).items;

      expect(spansOf(al[0]).map(({ text }) => text)).toEqual(["Al", "Alma"]);
      expect(spansOf(toDo[0]).map(({ text }) => text)).toEqual(["to", "do", "to", "do"]);
    });

    test("holds for a Task's title and a Project's and a Person's name as for an Entry", async () => {
      const context = newContext();
      const entry = await anEntry(context, marked("Support call"), {
        tasks: [{ title: marked("Fix log in for users in Paris") }],
      });
      const project = value(
        await context.call(hand, "create_project", { name: marked("Log in page in staging") }),
      ).record;
      const person = value(
        await context.call(hand, "create_person", { name: marked("Ana in Paris, Log In support") }),
      ).record;

      const results = value(await context.call(hand, "search", { words: "log in" })).items;

      const expected = {
        [`task:${entry.tasks[0]?.id}`]: { text: entry.tasks[0]?.title, spans: ["log", "in"] },
        [`project:${project.id}`]: { text: project.name, spans: ["Log", "in"] },
        [`person:${person.id}`]: { text: person.name, spans: ["Log", "In"] },
      };
      expect(
        Object.fromEntries(
          results.map((hit) => [
            `${hit.kind}:${hit.id}`,
            { text: hit.excerpt.text, spans: spansOf(hit).map(({ text }) => text) },
          ]),
        ),
      ).toEqual(expected);
    });
  });
});

/** Each span of a hit's excerpt as the text it marks and where it starts. */
function spansOf(hit: SearchHit | undefined) {
  const excerpt = hit?.excerpt ?? { text: "", matches: [] };
  return excerpt.matches.map(({ start, end }) => ({ text: excerpt.text.slice(start, end), start }));
}
