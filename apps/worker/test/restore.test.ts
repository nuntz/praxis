import {
  type ContextFile,
  contextFilePath,
  type Export,
  type ExportFile,
  exportZip,
} from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { meanAlike } from "./meaning-fake.ts";
import { answering, scriptModel } from "./model-fake.ts";
import { asRestored, base64, restore, restoredIds } from "./restoring.ts";
import { atOnce, DAY, hand, newDeployment, value } from "./seam.ts";

// Restoring an Export (section 10.2, ADR 0018): whole, with ids kept, into a Deployment that holds
// nothing yet, by the person's hand during setup. A Backup is the same file, restored the same way.

type Deployment = ReturnType<typeof newDeployment>;

async function makeContext(deployment: Deployment, name: string, accent = "blue") {
  const made = await deployment.call(hand, "create_context", {
    name,
    time_zone: "Europe/Paris",
    accent,
  });
  return value(made).record.id;
}

/** An Export's files as JSON, each as `edit` leaves it, in a zip Praxis would have written. */
function edited(made: Export, edit: (file: Record<string, unknown>) => Record<string, unknown>) {
  const files = made.files.map(({ path, content }) => ({
    path,
    content: edit({ ...content }) as unknown as ExportFile["content"],
  }));
  return base64(exportZip({ ...made, files }));
}

/**
 * The zip a system's own archiver makes of an Export's files once unpacked: each deflated, and a
 * line for their folder. Its checksums are left out, which Praxis does not read.
 */
async function deflatedZip(made: Export): Promise<string> {
  // macOS's archiver puts the files in a folder named after the one compressed, and adds its own.
  const folder = "praxis-export-2026-11-15/";
  const entries = [
    { path: folder, bytes: new Uint8Array() },
    { path: `${folder}contexts/`, bytes: new Uint8Array() },
    { path: `__MACOSX/${folder}._deployment.json`, bytes: new Uint8Array([0, 5, 22, 7]) },
    { path: `${folder}.DS_Store`, bytes: new Uint8Array([0, 0, 0, 1]) },
  ];
  for (const { path, content } of made.files) {
    const plain = new TextEncoder().encode(JSON.stringify(content, null, 2));
    const stream = new Blob([plain]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    entries.push({
      path: `${folder}${path}`,
      bytes: new Uint8Array(await new Response(stream).arrayBuffer()),
    });
  }
  const deflated = (path: string) => path.endsWith(".json") && !path.startsWith("__MACOSX/");
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { path, bytes } of entries) {
    const name = new TextEncoder().encode(path);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflated(path) ? 8 : 0, true);
    local.setUint32(18, bytes.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, bytes);
    const line = new DataView(new ArrayBuffer(46));
    line.setUint32(0, 0x02014b50, true);
    line.setUint16(10, deflated(path) ? 8 : 0, true);
    line.setUint32(20, bytes.length, true);
    line.setUint16(28, name.length, true);
    line.setUint32(42, offset, true);
    central.push(new Uint8Array(line.buffer), name);
    offset += 30 + name.length + bytes.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return base64(
    new Uint8Array(
      await new Blob([...parts, ...central, new Uint8Array(end.buffer)]).arrayBuffer(),
    ),
  );
}

/** The file of the Context with this id in an Export. */
function contextFile(made: Export, id: string): ContextFile {
  const file = made.files.find((f) => f.path === contextFilePath(id));
  if (file?.content.kind !== "context") throw new Error(`No file for the Context ${id}.`);
  return file.content;
}

describe("restore_export", () => {
  test("brings the whole Deployment back into one holding nothing, every record under its id, and it makes the same Export", async () => {
    const before = newDeployment("2026-11-15T09:00:00.000Z");
    const work = await makeContext(before, "Work");
    const home = await makeContext(before, "Home", "teal");
    const journal = before.context(work);
    const boiler = atOnce(
      await journal.call(hand, "record_entry", {
        words: marked("The boiler is making that noise again"),
        tasks: [{ title: marked("Call the plumber") }],
      }),
    ).record;
    const kitchen = atOnce(
      await journal.call(hand, "create_project", { name: marked("Kitchen") }),
    ).record;
    const [plumber] = boiler.tasks;
    if (plumber === undefined) throw new Error("Expected a Task");
    atOnce(await journal.call(hand, "move_task", { id: plumber.id, project_id: kitchen.id }));
    atOnce(
      await journal.call(hand, "add_link", {
        entry_id: boiler.id,
        to: { kind: "new_person", name: marked("Sam") },
      }),
    );
    atOnce(
      await journal.call(hand, "edit_entry", {
        id: boiler.id,
        words: marked("The boiler is knocking"),
        version: 0,
        tasks: [],
      }),
    );
    atOnce(await journal.call(hand, "mark_standing", { id: boiler.id }));
    await before.context(home).call(hand, "set_review_time", { day: "friday", time: null });
    await before.call(hand, "retire_context", { id: home });
    await before.call(hand, "set_spend_cap", { cap: 35 });
    const made = value(await before.call(hand, "make_export", {}));

    const after = newDeployment("2026-12-01T10:00:00.000Z");
    value(await restore(after, made));

    const ids = await restoredIds(made, after);
    expect(value(await after.call(hand, "make_export", {}))).toEqual(
      asRestored(made, ids, "2026-12-01T10:00:00.000Z"),
    );
    const restored = after.context(ids.get(work) ?? "");
    const entries = value(await restored.call(hand, "list_entries", {})).items;
    expect(entries.map(({ id }) => id)).toEqual([boiler.id]);
    expect(contextFile(made, work).entries[0]?.id).toBe(boiler.id);
  });

  test("is refused, with nothing changed, in a Deployment that holds a Context or a cap already", async () => {
    const before = newDeployment();
    const work = await makeContext(before, "Work");
    atOnce(await before.context(work).call(hand, "record_entry", { words: marked("Kept") }));
    const made = value(await before.call(hand, "make_export", {}));

    const holdingAContext = newDeployment();
    const home = await makeContext(holdingAContext, "Home");
    const holdingACap = newDeployment();
    value(await holdingACap.call(hand, "set_spend_cap", { cap: 40 }));

    for (const [into, listed] of [
      [holdingAContext, [home]],
      [holdingACap, []],
    ] as const) {
      expect(await restore(into, made)).toMatchObject({
        ok: false,
        error: { code: "refused", message: expect.stringMatching(/holds nothing yet/) },
      });
      const contexts = value(await into.call(hand, "list_contexts", {})).items;
      expect(contexts.map(({ id }) => id)).toEqual(listed);
    }
  });

  test("brings each Connection back ended, its name staying as the Author of what it made", async () => {
    const before = newDeployment();
    const work = await makeContext(before, "Work");
    const laptop = value(
      await before.call(hand, "create_connection", {
        name: "Laptop",
        context_id: work,
        reading_only: false,
      }),
    ).record;
    const asLaptop = { kind: "connection", id: laptop.id, name: laptop.name } as const;
    const noted = atOnce(
      await before
        .context(work)
        .call(asLaptop, "record_entry", { words: marked("Noted elsewhere") }),
    ).record;
    const made = value(await before.call(hand, "make_export", {}));

    const after = newDeployment();
    const restored = value(await restore(after, made));

    const [id] = restored.record.contexts.map((context) => context.id);
    expect(restored.record.connections).toEqual([
      {
        id: laptop.id,
        name: "Laptop",
        context_id: id,
        reading_only: false,
        address: laptop.address,
        ended: true,
      },
    ]);
    expect(value(await after.call(hand, "list_connections", {})).items).toEqual([]);
    expect(
      value(await after.context(id ?? "").call(hand, "get_entry", { id: noted.id })),
    ).toMatchObject({
      author: { kind: "connection", name: "Laptop" },
    });
  });

  test("keeps each Trash item's clock from its delete, removing for good what is past its 30 days as it comes back", async () => {
    const before = newDeployment("2026-11-01T09:00:00.000Z");
    const work = await makeContext(before, "Work");
    const journal = before.context(work);
    const old = atOnce(
      await journal.call(hand, "record_entry", { words: marked("Old news") }),
    ).record;
    const recent = atOnce(
      await journal.call(hand, "record_entry", { words: marked("Recent news") }),
    ).record;
    atOnce(await journal.call(hand, "delete_entry", { id: old.id }));
    before.advance(10 * DAY);
    atOnce(await journal.call(hand, "delete_entry", { id: recent.id }));
    before.advance(DAY);
    const made = value(await before.call(hand, "make_export", {}));

    // 31 days after the first delete, 21 after the second.
    const after = newDeployment("2026-12-02T09:00:00.000Z");
    const [id = ""] = value(await restore(after, made)).record.contexts.map(
      (context) => context.id,
    );
    const restored = after.context(id);

    expect(value(await restored.call(hand, "list_trash", {})).items).toEqual([
      expect.objectContaining({
        record: expect.objectContaining({ id: recent.id }),
        deleted_at: "2026-11-11T09:00:00.000Z",
        removed_at: "2026-12-11T09:00:00.000Z",
      }),
    ]);
    expect(await restored.call(hand, "restore", { id: old.id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    after.advance(9 * DAY);
    await after.fireAlarmOf(id);
    expect(value(await restored.call(hand, "list_trash", {})).items).toEqual([]);
  });

  describe("settles a unit caught moving between Contexts by its records' ids", () => {
    /**
     * Work, Home and Garage, with an Entry and its Task in Work taken out for a move to Home, not
     * yet taken there.
     */
    async function caughtMoving() {
      const before = newDeployment();
      const work = await makeContext(before, "Work");
      const home = await makeContext(before, "Home");
      const garage = await makeContext(before, "Garage");
      const garden = atOnce(
        await before.context(work).call(hand, "record_entry", {
          words: marked("The garden"),
          tasks: [{ title: marked("Water it") }],
        }),
      ).record;
      const unit = [garden.id, ...garden.tasks.map(({ id }) => id)];
      value(
        await before.beginMoveUnheard(work, {
          record: { kind: "entry", id: garden.id },
          unit,
          to: home,
        }),
      );
      return { before, work, home, garage, unit, garden };
    }

    /** The ids of the Entries and Tasks each Context restored from `made` lists, by its name. */
    async function heldAfterRestoring(made: Export) {
      const after = newDeployment();
      const { contexts } = value(await restore(after, made)).record;
      const held: Record<string, string[]> = {};
      for (const { id, name } of contexts) {
        const journal = after.context(id);
        held[name] = [
          ...value(await journal.call(hand, "list_entries", {})).items.map((entry) => entry.id),
          ...value(await journal.call(hand, "list_tasks", {})).items.map((task) => task.id),
        ];
      }
      return { after, held };
    }

    test("marked as moving with no copy elsewhere, it stays in the Context it was leaving", async () => {
      const { before, work, unit } = await caughtMoving();
      const made = value(await before.call(hand, "make_export", {}));
      expect(contextFile(made, work).moving).toHaveLength(1);

      const { held } = await heldAfterRestoring(made);

      expect(held).toEqual({ Work: unit, Home: [], Garage: [] });
    });

    test("found in the Context it was moving to as well, that one keeps it", async () => {
      const { before, work, home, unit } = await caughtMoving();
      // Work's object wrote its file while the unit was on its way; Home's once it had taken it.
      const leaving = contextFile(value(await before.call(hand, "make_export", {})), work);
      await before.fireAlarmOf(work);
      const arrived = value(await before.call(hand, "make_export", {}));
      expect(contextFile(arrived, home).entries.map(({ id }) => id)).toEqual([unit[0]]);
      const straddling: Export = {
        ...arrived,
        files: arrived.files.map((file) =>
          file.path === contextFilePath(work) ? { ...file, content: leaving } : file,
        ),
      };

      const { held } = await heldAfterRestoring(straddling);

      expect(held).toEqual({ Work: [], Home: unit, Garage: [] });
    });

    test("taken in by the Context it was moving to and on its way out of that one too, it is settled where it was last going from", async () => {
      const { before, work, home, garage, unit, garden } = await caughtMoving();
      const leaving = contextFile(value(await before.call(hand, "make_export", {})), work);
      await before.fireAlarmOf(work);
      value(
        await before.beginMoveUnheard(home, {
          record: { kind: "entry", id: garden.id },
          unit,
          to: garage,
        }),
      );
      const movingOn = value(await before.call(hand, "make_export", {}));
      expect(contextFile(movingOn, home).moving).toHaveLength(1);
      const straddling: Export = {
        ...movingOn,
        files: movingOn.files.map((file) =>
          file.path === contextFilePath(work) ? { ...file, content: leaving } : file,
        ),
      };

      const { held } = await heldAfterRestoring(straddling);

      expect(held).toEqual({ Work: [], Home: unit, Garage: [] });
    });
  });

  test("reads a file of format 1, bringing it forward as it is read", async () => {
    const before = newDeployment();
    const work = await makeContext(before, "Work");
    atOnce(await before.context(work).call(hand, "record_entry", { words: marked("Kept") }));
    const made = value(await before.call(hand, "make_export", {}));
    // Format 1 is format 2 without `moving` on a Context's file (docs/export-format.md).
    const format1 = edited(made, ({ moving: _, ...file }) => ({ ...file, format_version: 1 }));

    const after = newDeployment(made.made_at);
    value(await after.call(hand, "restore_export", { file: format1 }));

    expect(value(await after.call(hand, "make_export", {}))).toEqual(
      asRestored(made, await restoredIds(made, after), made.made_at),
    );
  });

  test("reads a zip a system's archiver made again of the files, deflated in a folder of their own", async () => {
    const before = newDeployment();
    const work = await makeContext(before, "Work");
    atOnce(
      await before.context(work).call(hand, "record_entry", { words: marked("Café, 屋根 🏠") }),
    );
    const made = value(await before.call(hand, "make_export", {}));

    const after = newDeployment(made.made_at);
    value(await after.call(hand, "restore_export", { file: await deflatedZip(made) }));

    expect(value(await after.call(hand, "make_export", {}))).toEqual(
      asRestored(made, await restoredIds(made, after), made.made_at),
    );
  });

  test("refuses a file of a newer format, and one that is not an Export or does not hold together, restoring nothing", async () => {
    const before = newDeployment();
    const work = await makeContext(before, "Work");
    const home = await makeContext(before, "Home");
    atOnce(await before.context(work).call(hand, "record_entry", { words: marked("Kept") }));
    atOnce(
      await before.context(home).call(hand, "record_entry", {
        words: marked("Garden"),
        tasks: [{ title: marked("Water it") }],
      }),
    );
    const made = value(await before.call(hand, "make_export", {}));
    const after = newDeployment();

    expect(
      await after.call(hand, "restore_export", {
        file: edited(made, (file) => ({ ...file, format_version: 3 })),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "refused", message: expect.stringMatching(/newer release/) },
    });
    const notOne = [
      "not base64!",
      base64(new TextEncoder().encode("Not a zip at all")),
      edited(made, (file) => ({ ...file, format: "something-else" })),
      edited(made, (file) => (file.kind === "deployment" ? { ...file, spend_cap: "lots" } : file)),
      // A Connection given twice.
      edited(made, (file) =>
        file.kind === "deployment"
          ? {
              ...file,
              connections: [
                { id: "twice", name: "Laptop", context_id: work },
                { id: "twice", name: "Phone", context_id: work },
              ],
            }
          : file,
      ),
      // Home's Trash, the second Context's, holds a record its file does not.
      edited(made, (file) =>
        file.kind === "context" && (file.context as { id: string }).id === home
          ? {
              ...file,
              trash: [
                {
                  deleted: { kind: "entry", id: "no-such-entry" },
                  went_with: [],
                  at: made.made_at,
                  dormant_links: [],
                },
              ],
            }
          : file,
      ),
      // Home's Task, the second Context's, comes from an Entry its file does not hold.
      edited(made, (file) =>
        file.kind === "context" && (file.context as { id: string }).id === home
          ? {
              ...file,
              tasks: (file.tasks as { origin_entry: string }[]).map((task) => ({
                ...task,
                origin_entry: "no-such-entry",
              })),
            }
          : file,
      ),
    ];
    for (const file of notOne) {
      expect(await after.call(hand, "restore_export", { file })).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }

    expect(value(await after.call(hand, "list_contexts", {})).items).toEqual([]);
    value(await restore(after, made));
    expect(value(await after.call(hand, "list_contexts", {})).items).toHaveLength(2);
  });

  test("brings a Run caught going back failed, since it cannot go on without its Conversation", async () => {
    scriptModel(answering(marked("Hello")));
    const before = newDeployment();
    const work = await makeContext(before, "Work");
    value(await before.context(work).callAny(hand, "send_message", { words: marked("Hi") }));
    await before.context(work).runsEnded();
    const made = value(await before.call(hand, "make_export", {}));
    const going = edited(made, (file) =>
      file.kind === "context"
        ? { ...file, runs: (file.runs as object[]).map((run) => ({ ...run, ended: null })) }
        : file,
    );

    const after = newDeployment();
    const [id = ""] = value(
      await after.call(hand, "restore_export", { file: going }),
    ).record.contexts.map((context) => context.id);

    const runs = value(await after.context(id).call(hand, "list_runs", {})).items;
    expect(runs).toEqual([
      expect.objectContaining({ id: contextFile(made, work).runs[0]?.id, ended: "failed" }),
    ]);
  });

  test("leaves the restored Journal to be found by meaning once its alarm has embedded it, by words meanwhile", async () => {
    meanAlike("dentist", "molar");
    const before = newDeployment();
    const work = await makeContext(before, "Work");
    const molar = atOnce(
      await before
        .context(work)
        .call(hand, "record_entry", { words: marked("Booked the molar check") }),
    ).record;
    const made = value(await before.call(hand, "make_export", {}));

    const after = newDeployment();
    const [id = ""] = value(await restore(after, made)).record.contexts.map(
      (context) => context.id,
    );
    const restored = after.context(id);
    expect(value(await restored.call(hand, "search", { words: "molar" })).items).toEqual([
      expect.objectContaining({ id: molar.id }),
    ]);
    await after.fireAlarmOf(id);
    await restored.meaningSettled();

    expect(value(await restored.call(hand, "search", { words: "dentist" }))).toMatchObject({
      items: [expect.objectContaining({ id: molar.id })],
      words_only: null,
    });
  });
});
