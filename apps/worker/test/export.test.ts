import type { ContextFile, DeploymentFile, Export, MessagesPage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { answering, scriptModel } from "./model-fake.ts";
import { agent, atOnce, connection, hand, newDeployment, value } from "./seam.ts";

// The Export (section 10.1, ADR 0018): the whole Deployment as files in Praxis's own JSON format,
// stamped with a format version, one for the Deployment and one per Context. The person's hand
// makes one from the Deployment's settings, and nothing else may.

type Deployment = ReturnType<typeof newDeployment>;

async function makeContext(
  deployment: Deployment,
  name: string,
  more: { time_zone?: string; accent?: string } = {},
) {
  const made = await deployment.call(hand, "create_context", {
    name,
    time_zone: more.time_zone ?? "UTC",
    accent: more.accent ?? "blue",
  });
  return value(made).record.id;
}

/** The Deployment's file of an Export. */
function deploymentFile(made: Export): DeploymentFile {
  const file = made.files.find((f) => f.path === "deployment.json");
  if (file?.content.kind !== "deployment") throw new Error("No Deployment file.");
  return file.content;
}

/** The file of the Context with this id in an Export. */
function fileOf(made: Export, id: string): ContextFile {
  const file = made.files.find((f) => f.path === `contexts/${id}.json`);
  if (file?.content.kind !== "context") throw new Error(`No file for the Context ${id}.`);
  return file.content;
}

describe("make_export", () => {
  test("is the whole Deployment: one file for the Deployment and one per Context, retired ones too, each stamped with the format version", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const work = await makeContext(deployment, "Work", { time_zone: "Europe/Paris" });
    const home = await makeContext(deployment, "Home", { accent: "teal" });
    await deployment.call(hand, "retire_context", { id: home });

    const made = value(await deployment.call(hand, "make_export", {}));

    expect(made.format_version).toBe(1);
    expect(made.made_at).toBe("2026-11-15T09:00:00.000Z");
    expect(made.files.map((f) => f.path)).toEqual([
      "deployment.json",
      `contexts/${work}.json`,
      `contexts/${home}.json`,
    ]);
    for (const { content } of made.files) {
      expect(content).toMatchObject({
        format: "praxis-export",
        format_version: 1,
        made_at: "2026-11-15T09:00:00.000Z",
      });
    }
    expect(deploymentFile(made).contexts).toEqual([
      { id: work, name: "Work", accent: "blue", retired: false, file: `contexts/${work}.json` },
      { id: home, name: "Home", accent: "teal", retired: true, file: `contexts/${home}.json` },
    ]);
    expect(fileOf(made, work).context).toEqual({
      id: work,
      name: "Work",
      time_zone: "Europe/Paris",
    });
    expect(fileOf(made, home).context.time_zone).toBe("UTC");
  });

  test("holds the spend cap and every Connection, ended ones too, and no Context's spend while it is not deleted", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    await deployment.call(hand, "set_spend_cap", { cap: 35 });
    const laptop = value(
      await deployment.call(hand, "create_connection", {
        name: "Laptop",
        context_id: work,
        reading_only: true,
      }),
    ).record;
    const phone = value(
      await deployment.call(hand, "create_connection", {
        name: "Phone",
        context_id: work,
        reading_only: false,
      }),
    ).record;
    await deployment.call(hand, "end_connection", { id: phone.id });
    // A Run in a Context not deleted: its spend is in its own Run records, not the Deployment's file.
    await deployment.context(work).callAny(hand, "send_message", { words: "Hello" });
    await deployment.context(work).runsEnded();

    const file = deploymentFile(value(await deployment.call(hand, "make_export", {})));

    expect(file.spend_cap).toBe(35);
    expect(file.connections).toEqual([
      { id: laptop.id, name: "Laptop", context_id: work },
      { id: phone.id, name: "Phone", context_id: work },
    ]);
    // Deleting a Context (#78) leaves its spend here, with no name; until then there is none.
    expect(file.deleted_contexts_spend).toEqual([]);
  });

  test("a Deployment whose cap was never set says so, rather than giving the cap it starts with", async () => {
    const deployment = newDeployment();

    const file = deploymentFile(value(await deployment.call(hand, "make_export", {})));

    expect(file.spend_cap).toBeNull();
    expect(file.contexts).toEqual([]);
  });

  test("holds a Context's Journal: each Entry as its words typed and its links as data, with its Versions and Standing mark, and each Task, Project and Person with what happened to it", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const id = await makeContext(deployment, "Work");
    const work = deployment.context(id);
    const at = (minutes: number) =>
      new Date(Date.parse("2026-11-15T09:00:00.000Z") + minutes * 60_000).toISOString();
    const step = async <T>(made: Promise<T>) => {
      const got = await made;
      deployment.advance(60_000);
      return got;
    };

    deployment.advance(60_000);
    const first = atOnce(
      await step(
        work.call(hand, "record_entry", {
          words: "Call Ana about the roof",
          tasks: [{ title: "Call the roofer" }],
          links: [
            { to: { kind: "new_person", name: "Ana" }, anchor: { start: 5, end: 8 } },
            { to: { kind: "new_project", name: "Roof" }, anchor: { start: 19, end: 23 } },
          ],
        }),
      ),
    ).record;
    const [ana, roof] = first.links.map((link) => link.to.id);
    const call = first.tasks[0]?.id ?? "";
    await step(
      work.call(hand, "edit_entry", {
        id: first.id,
        words: "Call Ana about the roof today",
        version: 0,
      }),
    );
    await step(work.call(hand, "mark_standing", { id: first.id }));
    await step(work.call(hand, "set_task_dates", { id: call, due_date: "2026-11-20" }));
    await step(
      work.call(hand, "set_recurrence", { id: call, recurrence: { kind: "days", every: 7 } }),
    );
    await step(work.call(hand, "delegate_task", { id: call, person_id: ana }));
    await step(work.call(hand, "move_task", { id: call, project_id: roof }));
    const second = atOnce(
      await step(
        work.call(hand, "record_entry", {
          words: "The roofer came",
          tasks: [{ title: "Pay the roofer" }],
          follow_up_to: first.id,
        }),
      ),
    ).record;
    const pay = second.tasks[0]?.id ?? "";
    await step(work.call(hand, "wait_on", { id: pay, on: { kind: "task", id: call } }));
    await step(work.call(hand, "set_project_due_date", { id: roof, due_date: "2026-12-01" }));
    // Finishing a Project drops its open Tasks by rule, so its ends are declared on one of its own.
    const garden = value(await step(work.call(hand, "create_project", { name: "Garden" }))).record;
    await step(work.call(hand, "finish_project", { id: garden.id }));
    await step(work.call(hand, "reopen_project", { id: garden.id }));
    const third = atOnce(
      await step(work.call(connection, "record_entry", { words: "From outside" })),
    ).record;

    const file = fileOf(value(await deployment.call(hand, "make_export", {})), id);

    expect(file.entries).toEqual([
      {
        id: first.id,
        words: "Call Ana about the roof today",
        at: at(1),
        author: { kind: "person" },
        through_conversation: false,
        follow_up_to: null,
        links: [
          { to: { kind: "person", id: ana }, anchor: { start: 5, end: 8, text: "Ana" } },
          { to: { kind: "project", id: roof }, anchor: { start: 19, end: 23, text: "roof" } },
        ],
        standing: true,
        versions: [
          {
            version: 0,
            words: "Call Ana about the roof",
            changed: { by: { kind: "person" }, at: at(2) },
          },
        ],
      },
      {
        id: second.id,
        words: "The roofer came",
        at: at(8),
        author: { kind: "person" },
        through_conversation: false,
        follow_up_to: first.id,
        links: [],
        standing: false,
        versions: [],
      },
      {
        id: third.id,
        words: "From outside",
        at: at(14),
        author: { kind: "connection", name: "Claude Code" },
        through_conversation: false,
        follow_up_to: null,
        links: [],
        standing: false,
        versions: [],
      },
    ]);
    expect(file.tasks).toEqual([
      {
        id: call,
        title: "Call the roofer",
        origin_entry: first.id,
        at: at(1),
        author: { kind: "person" },
        project: roof,
        due_date: "2026-11-20",
        defer_date: null,
        recurrence: { kind: "days", every: 7, from: "2026-11-20" },
        events: [{ what: "delegated", at: at(6), person: ana }],
      },
      {
        id: pay,
        title: "Pay the roofer",
        origin_entry: second.id,
        at: at(8),
        author: { kind: "person" },
        project: null,
        due_date: null,
        defer_date: null,
        recurrence: null,
        events: [{ what: "waited_on", at: at(9), on: { kind: "task", id: call } }],
      },
    ]);
    expect(file.projects).toEqual([
      {
        id: roof,
        name: "Roof",
        at: at(1),
        due_date: "2026-12-01",
        events: [],
      },
      {
        id: garden.id,
        name: "Garden",
        at: at(11),
        due_date: null,
        events: [
          { what: "finished", at: at(12) },
          { what: "reopened", at: at(13) },
        ],
      },
    ]);
    expect(file.persons).toEqual([{ id: ana, name: "Ana", at: at(1) }]);
  });

  test("holds the Trash with each item's clock, what went with it and the links it took away, and keeps its records in their lists", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const id = await makeContext(deployment, "Work");
    const work = deployment.context(id);
    const entry = atOnce(
      await work.call(hand, "record_entry", {
        words: "Fix the gate",
        tasks: [{ title: "Buy hinges" }],
        links: [{ to: { kind: "new_project", name: "Garden" } }],
      }),
    ).record;
    const [hinges] = entry.tasks;
    const garden = entry.links[0]?.to.id ?? "";
    await work.call(hand, "move_task", { id: hinges?.id, project_id: garden });
    deployment.advance(60_000);
    await work.call(hand, "delete_project", { id: garden });
    deployment.advance(60_000);
    const other = atOnce(
      await work.call(hand, "record_entry", { words: "Old note", tasks: [{ title: "Old task" }] }),
    ).record;
    deployment.advance(60_000);
    await work.call(hand, "delete_entry", { id: other.id });

    const file = fileOf(value(await deployment.call(hand, "make_export", {})), id);

    expect(file.trash).toEqual([
      {
        deleted: { kind: "project", id: garden },
        went_with: [],
        at: "2026-11-15T09:01:00.000Z",
        dormant_links: [{ task: hinges?.id, what: "project", to: { kind: "project", id: garden } }],
      },
      {
        deleted: { kind: "entry", id: other.id },
        went_with: [{ kind: "task", id: other.tasks[0]?.id }],
        at: "2026-11-15T09:03:00.000Z",
        dormant_links: [],
      },
    ]);
    expect(file.entries.map((e) => e.words)).toEqual(["Fix the gate", "Old note"]);
    expect(file.tasks.map((t) => [t.title, t.project])).toEqual([
      ["Buy hinges", null],
      ["Old task", null],
    ]);
    expect(file.projects.map((p) => p.name)).toEqual(["Garden"]);
  });

  test("holds each Run record with no words, and nothing of the Conversation, the change log or a Held Change", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const id = await makeContext(deployment, "Work");
    const work = deployment.context(id);
    const asked = marked("What is due today?");
    const answered = marked("Nothing is due.");
    scriptModel(answering(answered));
    await work.callAny(hand, "send_message", { words: asked });
    await work.runsEnded();
    const page = value(await work.callAny(hand, "list_messages", {})) as MessagesPage;
    const [answer] = page.items;
    if (answer?.from !== "agent") throw new Error("No answer.");
    const entry = atOnce(await work.call(hand, "record_entry", { words: "Mine" })).record;
    const heldWords = marked("The Agent's words for it");
    await work.call(agent, "edit_entry", { id: entry.id, words: heldWords, version: 0 });

    const made = value(await deployment.call(hand, "make_export", {}));
    const file = fileOf(made, id);

    expect(file.runs).toEqual([
      {
        id: answer.run.id,
        started_by: "message",
        at: "2026-11-15T09:00:00.000Z",
        model: "claude-sonnet-5-5",
        tokens: {
          input: expect.any(Number),
          output: expect.any(Number),
          cache_read: expect.any(Number),
          cache_write: expect.any(Number),
        },
        cost: answer.run.cost,
        ended: "answered",
        failure: null,
      },
    ]);
    expect(file.runs[0]?.tokens.output).toBeGreaterThan(0);
    expect(Object.keys(file).sort()).toEqual(
      [
        "format",
        "format_version",
        "made_at",
        "kind",
        "context",
        "entries",
        "tasks",
        "projects",
        "persons",
        "trash",
        "runs",
      ].sort(),
    );
    const whole = JSON.stringify(made);
    for (const words of [asked, answered, heldWords]) expect(whole).not.toContain(words);
    expect(file.entries.map((e) => [e.words, e.versions])).toEqual([["Mine", []]]);
  });

  test("has no Export of one Context: naming one is invalid input", async () => {
    const deployment = newDeployment();
    const id = await makeContext(deployment, "Work");

    const result = await deployment.call(hand, "make_export", { context_id: id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
  });
});
