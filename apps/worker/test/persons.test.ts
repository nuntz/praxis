import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, everyCaller, hand, newContext, value } from "./seam.ts";

type Context = ReturnType<typeof newContext>;

/** A Person made by the person. */
async function aPerson(context: Context, name = marked("Ali Khan")) {
  return value(await context.call(hand, "create_person", { name })).record;
}

describe("create_person", () => {
  test("makes a Person with a name and nothing else, never Mentioned, read by every caller", async () => {
    const context = newContext("2026-11-15T09:00:00.000Z");
    const name = marked("Ali Khan");

    const result = value(await context.call(agent, "create_person", { name }));

    expect(result.record).toEqual({
      id: expect.any(String),
      name,
      at: "2026-11-15T09:00:00.000Z",
      latest_mention: null,
    });
    expect(result.effects).toEqual([
      { kind: "person", id: result.record.id, what: "made", summary: name, by: "call" },
    ]);
    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "get_person", { id: result.record.id }))).toEqual(
        result.record,
      );
    }
  });

  test("two Persons may share a name and are two Persons", async () => {
    const context = newContext();
    const name = marked("Ali");

    const first = await aPerson(context, name);
    const second = await aPerson(context, name);

    expect(first.id).not.toBe(second.id);
    expect([first.name, second.name]).toEqual([name, name]);
  });

  test("a Person has a name of one line and nothing else", async () => {
    const context = newContext();

    for (const input of [
      { name: " " },
      { name: marked("Two\nlines") },
      { name: marked("Named"), email: "ali@example.com" },
      {},
    ]) {
      const result = await context.call(hand, "create_person", input);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await context.call(hand, "list_persons", {})).items).toEqual([]);
  });
});

describe("rename_person", () => {
  test("changes a Person's name", async () => {
    const context = newContext();
    const person = await aPerson(context);
    const name = marked("Alia Khan");

    const result = value(await context.call(connection, "rename_person", { id: person.id, name }));

    expect(result.record).toEqual({ ...person, name });
    expect(result.effects).toEqual([
      { kind: "person", id: person.id, what: "changed", summary: name, by: "call" },
    ]);
    expect(value(await context.call(hand, "get_person", { id: person.id }))).toEqual(result.record);
  });

  test("renaming a Person to the name they have changes nothing", async () => {
    const context = newContext();
    const person = await aPerson(context);

    const result = value(
      await context.call(hand, "rename_person", { id: person.id, name: person.name }),
    );

    expect(result).toEqual({ record: person, effects: [], changed: false });
  });

  test("a Person who is not in this Context is not found", async () => {
    const context = newContext();
    const elsewhere = await aPerson(newContext());

    const result = await context.call(hand, "rename_person", {
      id: elsewhere.id,
      name: marked("Renamed"),
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("get_person", () => {
  test("a Person who is not in this Context is not found", async () => {
    const context = newContext();
    const elsewhere = await aPerson(newContext());

    const result = await context.call(hand, "get_person", { id: elsewhere.id });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("list_persons", () => {
  test("lists the Context's Persons, newest first, 50 to a page, and a cursor reaches the rest", async () => {
    const context = newContext();
    const made: string[] = [];
    for (let n = 1; n <= 53; n++) made.push((await aPerson(context, marked(`Person ${n}`))).id);
    const newestFirst = made.toReversed();

    const first = value(await context.call(hand, "list_persons", {}));
    expect(first.items.map((person) => person.id)).toEqual(newestFirst.slice(0, 50));
    expect(first.next_cursor).toEqual(expect.any(String));

    const second = value(
      await context.call(connection, "list_persons", { cursor: first.next_cursor }),
    );
    expect(second.items.map((person) => person.id)).toEqual(newestFirst.slice(50));
    expect(second.next_cursor).toBeNull();
  });

  test("can be narrowed to the Persons whose name holds what was typed, whatever its case and accents", async () => {
    const context = newContext();
    const tag = marked("");
    const elodie = await aPerson(context, `Élodie Martin ${tag}`);
    const melodie = await aPerson(context, `Mélodie ${tag}`);
    await aPerson(context, `Ali Khan ${tag}`);

    const { items } = value(await context.call(hand, "list_persons", { named: "ELODIE" }));

    expect(items.map((person) => person.id)).toEqual([melodie.id, elodie.id]);
  });

  test("a cursor this list did not give is invalid input", async () => {
    const result = await newContext().call(hand, "list_persons", { cursor: "not-a-cursor" });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});
