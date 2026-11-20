import type { SearchHit } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, atOnce, connection, DAY, everyCaller, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** What a search found, each hit as its kind and id, best first. */
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
      excerpt: { text: words, matches: [{ start: 2, end: 8 }] },
    };
    for (const answer of answers) expect(answer).toEqual({ items: [hit], next_cursor: null });
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
      excerpt: { text: project.name, matches: [{ start: 0, end: 5 }] },
    });
    expect(results.find((hit) => hit.kind === "task")).toEqual({
      kind: "task",
      id: task?.id,
      summary: task?.title,
      at: task?.at,
      author: { kind: "person" },
      origin_entry: entry.id,
      excerpt: { text: task?.title, matches: [{ start: 9, end: 14 }] },
    });
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
    expect(second).toEqual({ items: expect.any(Array), next_cursor: null });
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
});
