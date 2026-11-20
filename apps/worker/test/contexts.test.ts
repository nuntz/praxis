import type { Entry, Task } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { failMeaningAfter, heldEmbeddings, setMeaningFailing } from "./meaning-fake.ts";
import { answering, type Script, scriptModel } from "./model-fake.ts";
import { agent, atOnce, everyCaller, hand, newDeployment, value } from "./seam.ts";

// The Deployment object holds the list of Contexts, with their names and accents and nothing from
// any Journal (section 9.2, ADR 0006). Its tools are offered to the person's hand only (4.11), and
// nothing crosses from one Context to another (ADR 0003).

type Deployment = ReturnType<typeof newDeployment>;

async function make(
  deployment: Deployment,
  name: string,
  accent = "blue",
  time_zone = "Europe/Paris",
): Promise<string> {
  const made = await deployment.call(hand, "create_context", { name, time_zone, accent });
  return value(made).record.id;
}

async function listed(deployment: Deployment) {
  return value(await deployment.call(hand, "list_contexts", {})).items;
}

describe("create_context", () => {
  test("makes a Context with its name and accent, its time zone kept in the Context's own object", async () => {
    const deployment = newDeployment("2026-11-15T23:30:00.000Z");

    const made = value(
      await deployment.call(hand, "create_context", {
        name: "Work",
        time_zone: "Pacific/Auckland",
        accent: "teal",
      }),
    );

    const listing = { id: expect.any(String), name: "Work", accent: "teal", retired: false };
    expect(made).toEqual({
      record: listing,
      effects: [{ kind: "context", id: made.record.id, what: "made", summary: "Work", by: "call" }],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([listing]);
    expect(value(await deployment.context(made.record.id).call(hand, "get_settings", {}))).toEqual({
      name: "Work",
      time_zone: "Pacific/Auckland",
      today: "2026-11-16",
      brief_time: "07:00",
      review_day: "sunday",
      review_time: "17:00",
      notifications: true,
    });
  });

  test("a name is one line, a time zone one of the IANA database, an accent one of the six", async () => {
    const deployment = newDeployment();
    const good = { name: "Work", time_zone: "Europe/Paris", accent: "rust" };

    for (const input of [
      { ...good, name: " " },
      { ...good, name: "Work\nand more" },
      { ...good, time_zone: "+01:00" },
      { ...good, time_zone: undefined },
      { ...good, accent: "red" },
      { ...good, accent: undefined },
    ]) {
      expect(await deployment.call(hand, "create_context", input)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
    expect(await listed(deployment)).toEqual([]);
  });

  test("each Context is its own, with an id unique across the Deployment", async () => {
    const deployment = newDeployment();

    const ids = [
      await make(deployment, "Work"),
      await make(deployment, "Work"),
      await make(deployment, "Home"),
    ];

    expect(new Set(ids).size).toBe(3);
    expect((await listed(deployment)).map((context) => context.id)).toEqual(ids);
  });
  test("a key given again returns the first result and makes no second Context", async () => {
    const deployment = newDeployment();
    const input = { name: "Work", time_zone: "Europe/Paris", accent: "rust", key: "make-work" };

    const first = await deployment.call(hand, "create_context", input);
    const again = await deployment.call(hand, "create_context", input);
    const otherTool = await deployment.call(hand, "rename_context", {
      id: value(first).record.id,
      name: "Studio",
      key: "make-work",
    });

    expect(again).toEqual(first);
    expect(otherTool).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await listed(deployment)).toEqual([value(first).record]);
  });
});

describe("list_contexts", () => {
  test("lists every Context in the order made, with its name, accent and whether it is retired, and nothing from its Journal", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work", "plum");
    const home = await make(deployment, "Home", "moss");
    await deployment
      .context(work)
      .call(hand, "record_entry", { words: marked("Quarterly plan"), tasks: [] });
    value(await deployment.call(hand, "retire_context", { id: home }));

    expect(await listed(deployment)).toEqual([
      { id: work, name: "Work", accent: "plum", retired: false },
      { id: home, name: "Home", accent: "moss", retired: true },
    ]);
  });
});

describe("rename_context", () => {
  test("renames the Context in the list and in its own settings, an Effect in its change log", async () => {
    const deployment = newDeployment();
    const id = await make(deployment, "Work");
    const context = deployment.context(id);

    const renamed = value(await deployment.call(hand, "rename_context", { id, name: "Studio" }));

    const effect = { kind: "context", id, what: "changed", summary: "Studio", by: "call" };
    expect(renamed).toEqual({
      record: { id, name: "Studio", accent: "blue", retired: false },
      effects: [effect],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([renamed.record]);
    expect(value(await context.call(agent, "get_settings", {})).name).toBe("Studio");
    // Whoever reads the Context's changes learns it was renamed, and by the person.
    expect(value(await context.call(agent, "list_changes", {})).items).toEqual([
      { at: "2026-11-15T09:00:00.000Z", caller: hand, tool: "rename_context", effects: [effect] },
    ]);
  });

  test("the name it has changes nothing, and a Context not made is not found", async () => {
    const deployment = newDeployment();
    const id = await make(deployment, "Work");

    expect(value(await deployment.call(hand, "rename_context", { id, name: "Work" }))).toEqual({
      record: { id, name: "Work", accent: "blue", retired: false },
      effects: [],
      changed: false,
    });
    expect(value(await deployment.context(id).call(hand, "list_changes", {})).items).toEqual([]);
    expect(
      await deployment.call(hand, "rename_context", { id: "no-such-context", name: "Home" }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("set_context_accent", () => {
  test("changes the Context's accent; the one it has changes nothing", async () => {
    const deployment = newDeployment();
    const id = await make(deployment, "Work", "blue");

    const changed = value(
      await deployment.call(hand, "set_context_accent", { id, accent: "rust" }),
    );
    const again = value(await deployment.call(hand, "set_context_accent", { id, accent: "rust" }));

    expect(changed.record).toEqual({ id, name: "Work", accent: "rust", retired: false });
    expect(changed.effects).toEqual([
      { kind: "context", id, what: "changed", summary: "Work", by: "call" },
    ]);
    expect(again).toEqual({ record: changed.record, effects: [], changed: false });
    expect(await listed(deployment)).toEqual([changed.record]);
  });

  test("an accent is one of the six, and a Context not made is not found", async () => {
    const deployment = newDeployment();
    const id = await make(deployment, "Work", "blue");

    expect(await deployment.call(hand, "set_context_accent", { id, accent: "pink" })).toMatchObject(
      { ok: false, error: { code: "invalid_input" } },
    );
    expect(
      await deployment.call(hand, "set_context_accent", { id: "no-such-context", accent: "teal" }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await listed(deployment))[0]?.accent).toBe("blue");
  });
});

describe("retire_context", () => {
  test("hides a Context: it is listed as retired and no request reaches it", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    await make(deployment, "Home");

    const retired = value(await deployment.call(hand, "retire_context", { id: work }));

    expect(retired).toEqual({
      record: { id: work, name: "Work", accent: "blue", retired: true },
      effects: [{ kind: "context", id: work, what: "changed", summary: "Work", by: "call" }],
      changed: true,
    });
    for (const caller of everyCaller) {
      expect(await deployment.context(work).call(caller, "get_settings", {})).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
    const again = value(await deployment.call(hand, "retire_context", { id: work }));
    expect(again).toEqual({ record: retired.record, effects: [], changed: false });
  });

  test("the last Context not retired cannot be, since there is always one", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    const home = await make(deployment, "Home");
    value(await deployment.call(hand, "retire_context", { id: home }));

    expect(await deployment.call(hand, "retire_context", { id: work })).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "context", id: work, summary: "Work" }] },
    });
    expect((await listed(deployment)).map((context) => context.retired)).toEqual([false, true]);
  });

  test("a Context not made is not found", async () => {
    const deployment = newDeployment();
    await make(deployment, "Work");

    expect(await deployment.call(hand, "retire_context", { id: "no-such-context" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("bring_back_context", () => {
  test("returns a retired Context with everything in it, since retiring deletes nothing", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    await make(deployment, "Home");
    const context = deployment.context(work);
    const { record: entry } = value(
      await context.call(hand, "record_entry", {
        words: marked("Budget review"),
        tasks: [{ title: marked("Send the figures") }],
      }),
    );
    value(await deployment.call(hand, "retire_context", { id: work }));

    const back = value(await deployment.call(hand, "bring_back_context", { id: work }));

    expect(back).toEqual({
      record: { id: work, name: "Work", accent: "blue", retired: false },
      effects: [{ kind: "context", id: work, what: "changed", summary: "Work", by: "call" }],
      changed: true,
    });
    expect(value(await context.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
  });

  test("one not retired changes nothing, and a Context not made is not found", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");

    const back = value(await deployment.call(hand, "bring_back_context", { id: work }));

    expect(back).toEqual({
      record: { id: work, name: "Work", accent: "blue", retired: false },
      effects: [],
      changed: false,
    });
    expect(
      await deployment.call(hand, "bring_back_context", { id: "no-such-context" }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("delete_context", () => {
  test("deletes a retired Context for good: it leaves the list, and no request reaches it", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    const home = await make(deployment, "Home");
    value(
      await deployment
        .context(work)
        .call(hand, "record_entry", { words: marked("Budget"), tasks: [] }),
    );
    value(await deployment.call(hand, "retire_context", { id: work }));

    const deleted = value(
      await deployment.call(hand, "delete_context", { id: work, name: "Work" }),
    );

    expect(deleted).toEqual({
      record: null,
      effects: [{ kind: "context", id: work, what: "deleted", summary: "Work", by: "call" }],
      changed: true,
    });
    expect((await listed(deployment)).map((context) => context.id)).toEqual([home]);
    for (const caller of everyCaller) {
      expect(await deployment.context(work).call(caller, "get_settings", {})).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
    // There is no way back: it cannot be brought back, and deleting it again finds nothing.
    for (const [tool, input] of [
      ["bring_back_context", { id: work }],
      ["delete_context", { id: work, name: "Work" }],
    ] as const) {
      expect(await deployment.call(hand, tool, input), tool).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });

  test("only a retired Context, and only given its name as it is listed", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    await make(deployment, "Home");
    const inTheWay = [{ kind: "context", id: work, summary: "Work" }];

    expect(await deployment.call(hand, "delete_context", { id: work, name: "Work" })).toMatchObject(
      { ok: false, error: { code: "refused", in_the_way: inTheWay } },
    );
    value(await deployment.call(hand, "retire_context", { id: work }));
    for (const name of ["work", "Work ", "Home", ""]) {
      expect(await deployment.call(hand, "delete_context", { id: work, name }), name).toMatchObject(
        { ok: false, error: { code: "refused", in_the_way: inTheWay } },
      );
    }
    expect(await deployment.call(hand, "delete_context", { id: work })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      await deployment.call(hand, "delete_context", { id: "no-such-context", name: "Work" }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });

    // Refused, it is as it was, and brought back with everything in it.
    value(await deployment.call(hand, "bring_back_context", { id: work }));
    expect(value(await deployment.context(work).call(hand, "get_settings", {})).name).toBe("Work");
  });

  test("takes its part of the meaning index out, an Entry in the Trash among them, and leaves every other Context's", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    const home = await make(deployment, "Home");
    const there = deployment.context(work);
    const kept = atOnce(
      await there.call(hand, "record_entry", { words: marked("Budget review") }),
    ).record;
    const trashed = atOnce(
      await there.call(hand, "record_entry", { words: marked("Old plan") }),
    ).record;
    atOnce(await there.call(hand, "delete_entry", { id: trashed.id }));
    const elsewhere = deployment.context(home);
    const theirs = atOnce(
      await elsewhere.call(hand, "record_entry", { words: marked("Fix the bike") }),
    ).record;
    await there.meaningSettled();
    await elsewhere.meaningSettled();
    expect([...heldEmbeddings(work).keys()].sort()).toEqual([kept.id, trashed.id].sort());
    value(await deployment.call(hand, "retire_context", { id: work }));

    value(await deployment.call(hand, "delete_context", { id: work, name: "Work" }));

    expect(heldEmbeddings(work).size).toBe(0);
    expect([...heldEmbeddings(home).keys()]).toEqual([theirs.id]);
  });

  test("while the meaning index does not answer, it is refused and nothing is deleted", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    await make(deployment, "Home");
    const there = deployment.context(work);
    const entry = atOnce(
      await there.call(hand, "record_entry", { words: marked("Budget") }),
    ).record;
    await there.meaningSettled();
    value(await deployment.call(hand, "retire_context", { id: work }));
    setMeaningFailing(true);

    expect(await deployment.call(hand, "delete_context", { id: work, name: "Work" })).toMatchObject(
      { ok: false, error: { code: "refused", in_the_way: [] } },
    );

    expect((await listed(deployment)).find((context) => context.id === work)?.retired).toBe(true);
    setMeaningFailing(false);
    value(await deployment.call(hand, "bring_back_context", { id: work }));
    expect(value(await there.call(hand, "get_entry", { id: entry.id }))).toEqual(entry);
    expect([...heldEmbeddings(work).keys()]).toEqual([entry.id]);
  });

  test("an Entry taken out before the meaning index stopped answering goes back in once the Context is brought back", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    await make(deployment, "Home");
    const there = deployment.context(work);
    // More than are taken out at once, so the outage begins part-way.
    for (let n = 0; n < 101; n += 1) {
      atOnce(await there.call(hand, "record_entry", { words: marked(`Note ${n}`) }));
    }
    await there.meaningSettled();
    const before = heldEmbeddings(work);
    const embedded = [...before.keys()].sort();
    expect(embedded).toHaveLength(101);
    value(await deployment.call(hand, "retire_context", { id: work }));
    failMeaningAfter(1);

    expect(await deployment.call(hand, "delete_context", { id: work, name: "Work" })).toMatchObject(
      { ok: false, error: { code: "refused" } },
    );

    expect(heldEmbeddings(work).size).toBeLessThan(101);
    setMeaningFailing(false);
    value(await deployment.call(hand, "bring_back_context", { id: work }));
    expect(value(await there.call(hand, "search", { words: "Note" })).words_only).toBe("stale");
    await there.meaningSettled();
    const after = heldEmbeddings(work);
    expect([...after.keys()].sort()).toEqual(embedded);
    // Only those taken out were embedded again: the one left in keeps the embedding it had.
    expect(embedded.filter((id) => after.get(id) === before.get(id))).toHaveLength(1);
    expect(value(await there.call(hand, "search", { words: "Note" })).words_only).toBeNull();
  });
});

describe("delete_context after its object was deleted and the answer lost", () => {
  test("deleting it again finishes, taking it off the list", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    const home = await make(deployment, "Home");
    value(await deployment.call(hand, "retire_context", { id: work }));
    // The object deleted its storage, and the Deployment object never heard.
    value(await deployment.deleteObjectUnheard(work));

    value(await deployment.call(hand, "delete_context", { id: work, name: "Work" }));

    expect((await listed(deployment)).map((context) => context.id)).toEqual([home]);
  });
});

describe("delete_context while a Run is going", () => {
  test("is refused, with nothing deleted, until the Run has ended", async () => {
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const done = answering("Done.");
    const held: Script = async (...args) => {
      await answered;
      return done(...args);
    };
    scriptModel(held);
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    await make(deployment, "Home");
    const there = deployment.context(work);
    value(await there.callAny(hand, "send_message", { words: "Hello" }));
    value(await deployment.call(hand, "retire_context", { id: work }));

    expect(await deployment.call(hand, "delete_context", { id: work, name: "Work" })).toMatchObject(
      { ok: false, error: { code: "refused", in_the_way: [] } },
    );
    expect((await listed(deployment)).map((context) => context.id)).toContain(work);

    answer();
    value(await deployment.call(hand, "bring_back_context", { id: work }));
    await there.runsEnded();
    value(await deployment.call(hand, "retire_context", { id: work }));
    value(await deployment.call(hand, "delete_context", { id: work, name: "Work" }));
  });
});

describe("nothing crosses a Context", () => {
  test("a record in one Context is not found in another", async () => {
    const deployment = newDeployment();
    const work = deployment.context(await make(deployment, "Work"));
    const home = deployment.context(await make(deployment, "Home"));
    const { record: entry } = value(
      await work.call(hand, "record_entry", {
        words: marked("Kickoff with Ana"),
        tasks: [{ title: marked("Draft the brief") }],
        links: [
          { to: { kind: "new_person", name: marked("Ana") } },
          { to: { kind: "new_project", name: marked("Launch") } },
        ],
      }),
    );
    const task = entry.tasks[0] as Task;
    const [person, project] = entry.links.map((link) => link.to.id) as [string, string];

    const calls = [
      ["get_entry", { id: entry.id }],
      ["get_task", { id: task.id }],
      ["get_person", { id: person }],
      ["get_project", { id: project }],
      ["finish_task", { id: task.id }],
      ["rename_person", { id: person, name: marked("Ana B") }],
      ["add_task", { entry_id: entry.id, title: marked("Reply") }],
    ] as const;
    for (const [tool, input] of calls) {
      expect(await home.callAny(hand, tool, input), tool).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
    for (const tool of ["list_entries", "list_tasks", "list_persons", "list_projects"] as const) {
      expect(value(await home.call(hand, tool, {})).items, tool).toEqual([]);
    }
  });

  test("a link or a wait naming a record of another Context is never made", async () => {
    const deployment = newDeployment();
    const work = deployment.context(await make(deployment, "Work"));
    const home = deployment.context(await make(deployment, "Home"));
    const { record: there } = value(
      await work.call(hand, "record_entry", {
        words: marked("Plan"),
        tasks: [{ title: marked("Book the room") }],
        links: [{ to: { kind: "new_person", name: marked("Ana") } }],
      }),
    );
    const theirTask = there.tasks[0] as Task;
    const theirPerson = there.links[0]?.to.id as string;
    const { record: here } = value(
      await home.call(hand, "record_entry", {
        words: marked("Weekend"),
        tasks: [{ title: marked("Fix the bike") }],
        links: [{ to: { kind: "task", id: theirTask.id } }],
      }),
    );
    const ourTask = here.tasks[0] as Task;

    expect(here.links).toEqual([]);
    expect(
      await home.call(hand, "wait_on", { id: ourTask.id, on: { kind: "task", id: theirTask.id } }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(
      await home.call(hand, "delegate_task", { id: ourTask.id, person_id: theirPerson }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(value(await work.call(hand, "get_entry", { id: there.id }))).toEqual<Entry>(there);
  });

  test("no Context tool takes a Context: the address the call arrives at decides it", async () => {
    const deployment = newDeployment();
    const work = await make(deployment, "Work");
    const home = deployment.context(await make(deployment, "Home"));

    for (const field of ["context", "context_id"]) {
      expect(
        await home.call(hand, "record_entry", { words: marked("Note"), [field]: work }),
      ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(value(await deployment.context(work).call(hand, "list_entries", {})).items).toEqual([]);
  });
});

describe("a Context stuck on its upgrade", () => {
  test("is neither renamed nor deleted, with nothing changed, since only a release mends it", async () => {
    const deployment = newDeployment();
    await make(deployment, "Work");
    const home = await make(deployment, "Home");
    value(await deployment.call(hand, "retire_context", { id: home }));
    await deployment.stickOnUpgrade(home);

    const stuck = { ok: false, error: { code: "refused", in_the_way: [] } };
    expect(
      await deployment.call(hand, "rename_context", { id: home, name: "House" }),
    ).toMatchObject(stuck);
    expect(await deployment.call(hand, "delete_context", { id: home, name: "Home" })).toMatchObject(
      stuck,
    );
    expect((await listed(deployment)).map(({ name }) => name)).toEqual(["Work", "Home"]);
  });
});
