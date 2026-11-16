import type { Entry } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, everyCaller, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** An Entry, a Task made with it, a Project and a Person, each in `context`. */
async function someRecords(context: Context) {
  const task = value(
    await context.call(hand, "record_entry", {
      words: marked("Landlord called"),
      tasks: [{ title: marked("Sign the lease") }],
    }),
  ).record.tasks[0];
  const project = value(
    await context.call(hand, "create_project", { name: marked("Move house") }),
  ).record;
  const person = value(await context.call(hand, "create_person", { name: marked("Ali") })).record;
  if (!task) throw new Error("No Task was made");
  return { task, project, person };
}

describe("record_entry's links", () => {
  test("are kept beside the words, each a Reference or a Mention, anchored or not, and the Entry is read with them", async () => {
    const context = newContext();
    const { task, project, person } = await someRecords(context);
    // Short enough that the Entry's summary is all of its words.
    const words = `@${person.name}`;
    const mention = { start: 0, end: words.length };

    const result = value(
      await context.call(hand, "record_entry", {
        words,
        links: [
          { to: { kind: "person", id: person.id }, anchor: mention },
          { to: { kind: "project", id: project.id } },
          { to: { kind: "task", id: task.id } },
        ],
      }),
    );

    expect(result.record.words).toBe(words);
    expect(result.record.links).toEqual([
      {
        kind: "mention",
        to: { kind: "person", id: person.id, summary: person.name },
        anchor: mention,
      },
      {
        kind: "reference",
        to: { kind: "project", id: project.id, summary: project.name },
        anchor: null,
      },
      { kind: "reference", to: { kind: "task", id: task.id, summary: task.title }, anchor: null },
    ]);
    // A link is part of the Entry: no record it names changes.
    expect(result.effects).toEqual([
      { kind: "entry", id: result.record.id, what: "made", summary: words, by: "call" },
    ]);
    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "get_entry", { id: result.record.id }))).toEqual(
        result.record,
      );
    }
    const listed = value(await context.call(hand, "list_entries", {})).items[0];
    expect(listed).toEqual(result.record);
  });

  test("an Entry with no links is read with none", async () => {
    const context = newContext();

    const { record } = value(
      await context.call(hand, "record_entry", { words: marked("Nothing to link") }),
    );

    expect(record.links).toEqual([]);
  });

  test("a link may name a new Person or Project, made in the same call", async () => {
    const context = newContext();
    const ali = marked("Ali");
    const garden = marked("Garden");
    const words = marked("Met them");

    const { record, effects } = value(
      await context.call(connection, "record_entry", {
        words,
        links: [
          { to: { kind: "new_person", name: ali }, anchor: { start: 4, end: 8 } },
          { to: { kind: "new_project", name: garden } },
        ],
      }),
    );

    const [mention, reference] = record.links;
    expect(mention).toMatchObject({ kind: "mention", to: { kind: "person", summary: ali } });
    expect(reference).toMatchObject({
      kind: "reference",
      to: { kind: "project", summary: garden },
    });
    expect(effects).toEqual([
      { kind: "entry", id: record.id, what: "made", summary: words, by: "call" },
      { kind: "person", id: mention?.to.id, what: "made", summary: ali, by: "call" },
      { kind: "project", id: reference?.to.id, what: "made", summary: garden, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_person", { id: mention?.to.id })).name).toBe(ali);
    expect(value(await context.call(hand, "get_project", { id: reference?.to.id })).name).toBe(
      garden,
    );
  });

  test("the words are never refused for a link: one to a record not in this Context is not kept, and the rest are", async () => {
    const context = newContext();
    const { person } = await someRecords(context);
    const elsewhere = await someRecords(newContext());
    const words = marked("Linked here and elsewhere");

    const { record, effects } = value(
      await context.call(agent, "record_entry", {
        words,
        links: [
          { to: { kind: "task", id: elsewhere.task.id } },
          { to: { kind: "person", id: person.id } },
          { to: { kind: "project", id: elsewhere.project.id } },
          { to: { kind: "person", id: elsewhere.person.id } },
        ],
      }),
    );

    expect(record.words).toBe(words);
    expect(record.links).toEqual([
      {
        kind: "mention",
        to: { kind: "person", id: person.id, summary: person.name },
        anchor: null,
      },
    ]);
    expect(effects).toEqual([
      { kind: "entry", id: record.id, what: "made", summary: words, by: "call" },
    ]);
  });

  test("the words are never refused for an anchor: one past their end is kept without it", async () => {
    const context = newContext();
    const { person } = await someRecords(context);
    const words = "Met Ali";

    const { record } = value(
      await context.call(hand, "record_entry", {
        words,
        links: [{ to: { kind: "person", id: person.id }, anchor: { start: 4, end: 8 } }],
      }),
    );

    expect(record.words).toBe(words);
    expect(record.links).toEqual([
      {
        kind: "mention",
        to: { kind: "person", id: person.id, summary: person.name },
        anchor: null,
      },
    ]);
  });

  test("an anchor that is no span at all is invalid input", async () => {
    const context = newContext();
    const { person } = await someRecords(context);

    for (const anchor of [
      { start: 3, end: 3 },
      { start: 4, end: 2 },
      { start: -1, end: 2 },
      { start: 0.5, end: 2 },
    ]) {
      const result = await context.call(hand, "record_entry", {
        words: marked("Met Ali"),
        links: [{ to: { kind: "person", id: person.id }, anchor }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "list_entries", {})).items).toHaveLength(1);
  });

  test("a link's kind follows from what it names, and a caller cannot state it", async () => {
    const context = newContext();
    const { person } = await someRecords(context);

    for (const link of [
      { kind: "reference", to: { kind: "person", id: person.id } },
      { to: { kind: "entry", id: "an-entry" } },
      { to: { kind: "new_person" } },
      { to: { kind: "new_person", name: "Two\nlines" } },
    ]) {
      const result = await context.call(hand, "record_entry", {
        words: marked("Linked"),
        links: [link],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });
});

describe("add_link", () => {
  test("adds a Reference or a Mention to an Entry without changing its words, even the person's words for the Agent", async () => {
    const context = newContext();
    const { project, person } = await someRecords(context);
    const words = marked("Thinking about the move");
    const entry = value(await context.call(hand, "record_entry", { words })).record;

    const referenced = value(
      await context.call(agent, "add_link", {
        entry_id: entry.id,
        to: { kind: "project", id: project.id },
      }),
    );
    const mentioned = value(
      await context.call(agent, "add_link", {
        entry_id: entry.id,
        to: { kind: "person", id: person.id },
        anchor: { start: 0, end: 8 },
      }),
    );

    expect(referenced.effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: words, by: "call" },
    ]);
    expect(mentioned.record).toEqual({
      ...entry,
      links: [
        {
          kind: "reference",
          to: { kind: "project", id: project.id, summary: project.name },
          anchor: null,
        },
        {
          kind: "mention",
          to: { kind: "person", id: person.id, summary: person.name },
          anchor: { start: 0, end: 8 },
        },
      ],
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(
      mentioned.record,
    );
  });

  test("may name a new Person or Project to make in the same call", async () => {
    const context = newContext();
    const entry = value(await context.call(hand, "record_entry", { words: marked("Met") })).record;
    const name = marked("Bea");

    const { record, effects } = value(
      await context.call(connection, "add_link", {
        entry_id: entry.id,
        to: { kind: "new_person", name },
      }),
    );

    const person = record.links[0]?.to;
    expect(person).toEqual({ kind: "person", id: expect.any(String), summary: name });
    expect(effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: entry.words, by: "call" },
      { kind: "person", id: person?.id, what: "made", summary: name, by: "call" },
    ]);
  });

  test("linking what an Entry already links changes nothing", async () => {
    const context = newContext();
    const { task } = await someRecords(context);
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("Signed it"),
        links: [{ to: { kind: "task", id: task.id }, anchor: { start: 0, end: 6 } }],
      }),
    ).record;

    for (const link of [
      { to: { kind: "task", id: task.id }, anchor: { start: 0, end: 6 } },
      { to: { kind: "task", id: task.id } },
    ]) {
      const result = value(await context.call(hand, "add_link", { entry_id: entry.id, ...link }));
      expect(result).toEqual({ record: entry, effects: [], changed: false });
    }
  });

  test("the same record can be linked again at another span", async () => {
    const context = newContext();
    const { person } = await someRecords(context);
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("Ali said Ali would"),
        links: [{ to: { kind: "person", id: person.id }, anchor: { start: 0, end: 3 } }],
      }),
    ).record;

    const { record } = value(
      await context.call(hand, "add_link", {
        entry_id: entry.id,
        to: { kind: "person", id: person.id },
        anchor: { start: 9, end: 12 },
      }),
    );

    expect(record.links.map((link) => link.anchor)).toEqual([
      { start: 0, end: 3 },
      { start: 9, end: 12 },
    ]);
  });

  test("an Entry or a record that is not in this Context is not found", async () => {
    const context = newContext();
    const { person } = await someRecords(context);
    const entry = value(await context.call(hand, "record_entry", { words: marked("Here") })).record;
    const elsewhere = await someRecords(newContext());

    for (const input of [
      { entry_id: "no-such-entry", to: { kind: "person", id: person.id } },
      { entry_id: entry.id, to: { kind: "person", id: elsewhere.person.id } },
      { entry_id: entry.id, to: { kind: "task", id: elsewhere.task.id } },
    ]) {
      const result = await context.call(hand, "add_link", input);
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });

  test("an anchor past the end of the words is invalid input", async () => {
    const context = newContext();
    const { person } = await someRecords(context);
    const entry = value(await context.call(hand, "record_entry", { words: "Met Ali" })).record;

    const result = await context.call(hand, "add_link", {
      entry_id: entry.id,
      to: { kind: "person", id: person.id },
      anchor: { start: 4, end: 8 },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("remove_link", () => {
  test("removes every link from an Entry to a record, without changing its words", async () => {
    const context = newContext();
    const { project, person } = await someRecords(context);
    const words = marked("Ali and Ali on the move");
    const entry = value(
      await context.call(hand, "record_entry", {
        words,
        links: [
          { to: { kind: "person", id: person.id }, anchor: { start: 0, end: 3 } },
          { to: { kind: "project", id: project.id } },
          { to: { kind: "person", id: person.id }, anchor: { start: 8, end: 11 } },
        ],
      }),
    ).record;

    const { record, effects } = value(
      await context.call(agent, "remove_link", {
        entry_id: entry.id,
        to: { kind: "person", id: person.id },
      }),
    );

    expect(record).toEqual({ ...entry, links: [entry.links[1]] });
    expect(effects).toEqual([
      { kind: "entry", id: entry.id, what: "changed", summary: words, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_person", { id: person.id })).latest_mention).toBe(
      null,
    );
  });

  test("given an anchor, removes only the link at that span", async () => {
    const context = newContext();
    const { person } = await someRecords(context);
    const entry = value(
      await context.call(hand, "record_entry", {
        words: marked("Ali and Ali"),
        links: [
          { to: { kind: "person", id: person.id }, anchor: { start: 0, end: 3 } },
          { to: { kind: "person", id: person.id }, anchor: { start: 8, end: 11 } },
        ],
      }),
    ).record;

    const { record } = value(
      await context.call(hand, "remove_link", {
        entry_id: entry.id,
        to: { kind: "person", id: person.id },
        anchor: { start: 8, end: 11 },
      }),
    );

    expect(record.links).toEqual([entry.links[0]]);
  });

  test("removing a link the Entry does not have changes nothing", async () => {
    const context = newContext();
    const { task } = await someRecords(context);
    const entry = value(
      await context.call(hand, "record_entry", { words: marked("Alone") }),
    ).record;

    const result = value(
      await context.call(hand, "remove_link", {
        entry_id: entry.id,
        to: { kind: "task", id: task.id },
      }),
    );

    expect(result).toEqual({ record: entry, effects: [], changed: false });
  });

  test("an Entry that is not in this Context is not found", async () => {
    const context = newContext();
    const { task } = await someRecords(context);

    const result = await context.call(hand, "remove_link", {
      entry_id: "no-such-entry",
      to: { kind: "task", id: task.id },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("a Person's latest Mention", () => {
  test("tells two Persons with one name apart by the latest Entry that Mentions each", async () => {
    const context = newContext("2026-11-01T09:00:00.000Z");
    const name = marked("Ali");
    const neighbour = value(await context.call(hand, "create_person", { name })).record;
    const colleague = value(await context.call(hand, "create_person", { name })).record;
    const mention = async (words: string, id: string): Promise<Entry> =>
      value(
        await context.call(hand, "record_entry", {
          words,
          links: [{ to: { kind: "person", id } }],
        }),
      ).record;

    await mention(marked("Fence repaired"), neighbour.id);
    context.advance(60_000);
    const latestForNeighbour = await mention(marked("Borrowed the ladder"), neighbour.id);
    context.advance(60_000);
    const latestForColleague = await mention(marked("Reviewed the budget"), colleague.id);

    const { items } = value(await context.call(connection, "list_persons", {}));

    expect(items).toEqual([
      {
        ...colleague,
        latest_mention: {
          entry: latestForColleague.id,
          at: "2026-11-01T09:02:00.000Z",
          summary: latestForColleague.words,
        },
      },
      {
        ...neighbour,
        latest_mention: {
          entry: latestForNeighbour.id,
          at: "2026-11-01T09:01:00.000Z",
          summary: latestForNeighbour.words,
        },
      },
    ]);
  });
});
