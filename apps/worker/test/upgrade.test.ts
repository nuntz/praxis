import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  DEPLOYMENT_FILE,
  EXPORT_FORMAT_VERSION,
  type Export,
  type MessagesPage,
  readExport,
} from "@praxis/domain";
import { describe, expect, test, vi } from "vitest";
import { ACCESS_TOKEN_HEADER } from "../src/access.ts";
import { RUNTIME_TABLES } from "../src/agent.ts";
import { CONTEXT_LADDER, DEPLOYMENT_LADDER, type Step } from "../src/steps/index.ts";
import { WORDS_INDEX } from "../src/tables.ts";
import { praxis } from "../src/worker.ts";
import { fakeAccess, TEST_APPLICATION, THROUGH_OAUTH } from "./access-fake.ts";
import { type Dump, dumpObject, layDump, shapeOf } from "./dump.ts";
import { type FixtureIds, fixtureName } from "./fixture-scenario.ts";
import pending from "./fixtures/pi-1.5.2-pending/pending.json";
import { adoptMarkers, marked } from "./markers.ts";
import { holdMeanings } from "./meaning-fake.ts";
import { calling, scriptModel } from "./model-fake.ts";
import { asRestored, restore, restoredIds } from "./restoring.ts";
import {
  contextIn,
  contextWithItsDeployment,
  DAY,
  hand,
  newDeployment,
  value,
  wakeAgain,
} from "./seam.ts";
import { addSteps, failingStep, mendSteps, wakeUnder } from "./upgrade-faults.ts";
import { holdSessions } from "./voice-fake.ts";

// The upgrade test of section 13 (ADR 0019). Each release committed a fixture: a Context object
// and a Deployment object filled by a fixed scenario through the tools of that release, saved as a
// dump beside the Export it made (test/fixture-scenario.ts, `bun run fixture`). Each is laid in an
// object and woken under the current code, which climbs its ladders. It is the one test that lays
// tables in an object and reads where its ladder stands; what the tools answer is read through
// them.

type Objects = { ids: FixtureIds; context: Dump; deployment: Dump };

/** Each release's fixture, by name: the objects' dumps and the Export they made. */
const fixtures = (() => {
  const objects = import.meta.glob<Objects>("./fixtures/*/objects.json", {
    eager: true,
    import: "default",
  });
  const exports = import.meta.glob<Export>("./fixtures/*/export.json", {
    eager: true,
    import: "default",
  });
  return Object.entries(objects).map(([path, laid]) => {
    const name = path.split("/")[2] ?? path;
    const made = exports[path.replace("objects.json", "export.json")];
    if (made === undefined) throw new Error(`The fixture ${name} has no Export beside it`);
    return { name, ...laid, made };
  });
})();

type Fixture = (typeof fixtures)[number];

/**
 * An Export saved by an earlier release, brought forward through the file's ladder to the format
 * this code writes, as a restore reads it (section 10.1).
 */
function broughtForward(made: Export): Export {
  const read = readExport(
    made.files.map(({ path, content }) => ({ path, text: JSON.stringify(content) })),
  );
  if (!read.ok) throw new Error(`The fixture's Export cannot be read: ${read.error.message}`);
  return {
    format_version: EXPORT_FORMAT_VERSION,
    made_at: made.made_at,
    files: [
      { path: DEPLOYMENT_FILE, content: read.value.deployment },
      ...read.value.contexts.map(({ listed, file }) => ({ path: listed.file, content: file })),
    ],
  };
}

function contextObjectOf(fixture: Fixture) {
  return env.CONTEXT.get(env.CONTEXT.idFromString(fixture.ids.context));
}

function deploymentObjectOf(fixture: Fixture) {
  return env.DEPLOYMENT.get(env.DEPLOYMENT.idFromString(fixture.ids.deployment));
}

/**
 * Lay a fixture in its objects, by the ids they had, and wake them under the current code. Its
 * words are held to the check that no words leave, as a test's own are.
 */
async function wakeFixture(fixture: Fixture) {
  adoptMarkers(JSON.stringify(fixture.context));
  // The meaning index is outside the object, and outlives a deploy as the object does.
  const entries = (fixture.context.rows.entries ?? []) as { id: string; words: string }[];
  holdMeanings(fixture.ids.context, entries);
  // So is the voice provider, which set up the fixture's Calls.
  const calls = (fixture.context.rows.calls ?? []) as { session: string }[];
  holdSessions(calls.map(({ session }) => session));
  await layDump(deploymentObjectOf(fixture), fixture.deployment);
  await layDump(contextObjectOf(fixture), fixture.context);
  const deployment = newDeployment(fixture.ids.at, fixture.ids.deployment);
  return { deployment, context: deployment.context(fixture.ids.context) };
}

/**
 * The fixture's Context as this release's ladder leaves it, at the top of the ladder: the step
 * before one a test adds. An older release's fixture climbs this release's steps to reach it.
 */
async function climbed(fixture: Fixture): Promise<Dump> {
  const { context } = await wakeFixture(fixture);
  value(await context.call(hand, "get_settings", {}));
  return dumpObject(contextObjectOf(fixture));
}

/** The step a fixture's Context stood on when it was saved. */
function savedStep(fixture: Fixture): number {
  const [ladder] = (fixture.context.rows.ladder ?? []) as { step: number }[];
  if (ladder === undefined) throw new Error(`The fixture ${fixture.name} holds no ladder`);
  return ladder.step;
}

/** Where an object stands on its ladder. */
function ladderOf(stub: DurableObjectStub) {
  return runInDurableObject(stub, (_, state) =>
    state.storage.sql
      .exec<{ step: number; stuck_under: string | null; stuck_step: number | null }>(
        `SELECT step, stuck_under, stuck_step FROM ladder`,
      )
      .one(),
  );
}

/** A new Context and its Deployment, made under the current code, to compare shapes against. */
async function freshObjects() {
  const deployment = newDeployment();
  const { id } = await contextIn(deployment, "Fresh", { accent: "teal" });
  return {
    context: env.CONTEXT.get(env.CONTEXT.idFromString(id)),
    deployment: env.DEPLOYMENT.get(env.DEPLOYMENT.idFromString(deployment.id)),
  };
}

/**
 * A dump without where its ladder stands, which a climb notes, and with what it made in no order,
 * since laying a dump makes its indexes after its tables.
 */
function rowsOutsideTheLadder(dump: Dump) {
  const { ladder: _, ...rows } = dump.rows;
  const made = dump.made.toSorted((a, b) =>
    `${a.type} ${a.name}`.localeCompare(`${b.type} ${b.name}`),
  );
  return { made, rows, sequence: dump.sequence };
}

test("this release has a fixture of its own", () => {
  expect(
    fixtures.map(({ name }) => name),
    "A release that adds a step commits a fixture of its tables: run `bun run fixture` in apps/worker",
  ).toContain(fixtureName());
});

describe.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
  "the fixture %s, woken under this release",
  (_, fixture) => {
    test("climbs to the top of each ladder, its tables shaped as a new object's", async () => {
      await wakeFixture(fixture);
      const fresh = await freshObjects();

      expect(await ladderOf(contextObjectOf(fixture))).toEqual({
        step: CONTEXT_LADDER.length,
        stuck_under: null,
        stuck_step: null,
      });
      expect((await ladderOf(deploymentObjectOf(fixture))).step).toBe(DEPLOYMENT_LADDER.length);
      expect(await shapeOf(contextObjectOf(fixture))).toEqual(await shapeOf(fresh.context));
      expect(await shapeOf(deploymentObjectOf(fixture))).toEqual(await shapeOf(fresh.deployment));
    });

    test("makes the Export it made, brought forward", async () => {
      const { deployment } = await wakeFixture(fixture);

      expect(value(await deployment.call(hand, "make_export", {}))).toEqual(
        broughtForward(fixture.made),
      );
    });

    test("restores from the Export it made into a new Deployment, which makes that Export again", async () => {
      adoptMarkers(JSON.stringify(fixture.made));
      const made = broughtForward(fixture.made);
      const after = newDeployment(fixture.ids.at);

      value(await restore(after, fixture.made));

      expect(value(await after.call(hand, "make_export", {}))).toEqual(
        asRestored(made, await restoredIds(made, after), fixture.ids.at),
      );
    });

    test("still shows its change log, its Device, its Conversation and a working Connection", async () => {
      const { deployment, context } = await wakeFixture(fixture);
      const { connection, device } = fixture.ids;
      const asConnection = { kind: "connection", ...connection } as const;

      const changes = value(await context.call(hand, "list_changes", {})).items;
      expect(changes.length).toBe(fixture.context.rows.change_calls?.length);
      expect(changes.some(({ caller }) => caller.kind === "connection")).toBe(true);
      expect(value(await deployment.call(hand, "list_devices", {})).items).toEqual([
        expect.objectContaining({ id: device, notifications: true }),
      ]);
      const messages = value(await context.callAny(hand, "list_messages", {})) as {
        items: unknown[];
        agent: string;
      };
      expect(messages.agent).toBe("available");
      expect(messages.items.length).toBeGreaterThan(0);
      expect(await deploymentObjectOf(fixture).callableConnection(connection.id)).toMatchObject({
        id: connection.id,
        ended: false,
      });
      value(await context.call(asConnection, "record_entry", { words: "Still connected" }));
    });

    test("has its next Brief answered, its Conversation asked of the tools this release offers", async () => {
      const { deployment, context } = await wakeFixture(fixture);
      deployment.advance(DAY);
      await context.fireAlarm();
      await context.runsEnded();

      const runs = value(await context.call(hand, "list_runs", {})).items;
      expect(runs.find(({ started_by }) => started_by === "brief")).toMatchObject({
        ended: "answered",
      });
    });

    test("a step made to fail leaves it whole on the step before, serving nothing, until a release mends it", async () => {
      const before = rowsOutsideTheLadder(await climbed(fixture));
      addSteps(fixture.ids.context, failingStep);
      wakeUnder("release-with-a-bad-step");
      const { deployment, context } = await wakeFixture(fixture);

      expect(await ladderOf(contextObjectOf(fixture))).toEqual({
        step: CONTEXT_LADDER.length,
        stuck_under: "release-with-a-bad-step",
        stuck_step: CONTEXT_LADDER.length + 1,
      });
      expect(rowsOutsideTheLadder(await dumpObject(contextObjectOf(fixture)))).toEqual(before);
      const refused = await context.call(hand, "list_entries", {});
      expect(refused).toMatchObject({ ok: false, error: { code: "refused", in_the_way: [] } });
      expect(refused.ok ? "" : refused.error.message).toMatch(
        `step ${CONTEXT_LADDER.length + 1} of its upgrade failed under release release-with-a-bad-step`,
      );
      expect(await context.callAny(hand, "list_messages", {})).toMatchObject({ ok: false });

      // The other Contexts work, and name it.
      const { record: other } = await contextIn(deployment, "Work", { accent: "rust" });
      const stuckNotice = {
        kind: "context_stuck",
        context: "Personal",
        release: "release-with-a-bad-step",
        backup_kept: expect.any(String),
      };
      await vi.waitFor(async () =>
        expect(
          value(await deployment.context(other.id).call(hand, "list_notices", {})).items,
        ).toContainEqual(stuckNotice),
      );
      expect(await deployment.call(hand, "make_export", {})).toMatchObject({
        ok: false,
        error: { code: "refused", in_the_way: [{ kind: "context", id: fixture.ids.context }] },
      });

      // Its clock stops: nothing in its Trash goes, past its 30 days, and nothing is pruned.
      deployment.advance(31 * DAY);
      await deployment.fireAlarmOf(fixture.ids.context);
      expect(rowsOutsideTheLadder(await dumpObject(contextObjectOf(fixture)))).toEqual(before);

      // Woken again under the same release, it does not try again, though the step is mended.
      mendSteps(fixture.ids.context);
      await wakeAgain(contextObjectOf(fixture));
      expect(await context.call(hand, "list_entries", {})).toMatchObject({ ok: false });

      // Under a release that mends it, it climbs, serves, and is named no more.
      wakeUnder("release-that-mends-it");
      await wakeAgain(contextObjectOf(fixture));
      await deployment.fireAlarmOf(fixture.ids.context);
      expect(value(await context.call(hand, "list_trash", {})).items).toEqual([]);
      expect(await ladderOf(contextObjectOf(fixture))).toMatchObject({
        step: CONTEXT_LADDER.length,
        stuck_under: null,
      });
      await vi.waitFor(async () =>
        expect(
          value(await deployment.context(other.id).call(hand, "list_notices", {})).items,
        ).not.toContainEqual(stuckNotice),
      );
    });

    test("a step that changes the change log, a Version or an Entry's words fails", async () => {
      const changing: Step[] = [
        (sql) => sql.exec(`UPDATE entries SET words = words || ' and more'`),
        (sql) => sql.exec(`DELETE FROM entry_versions`),
        (sql) => sql.exec(`UPDATE changes SET summary = ''`),
        (sql) =>
          sql.exec(`DELETE FROM change_calls WHERE seq = (SELECT max(seq) FROM change_calls)`),
      ];
      const before = rowsOutsideTheLadder(await climbed(fixture));
      for (const [place, step] of changing.entries()) {
        mendSteps(fixture.ids.context);
        addSteps(fixture.ids.context, step);
        wakeUnder(`release-${place}`);
        const { context } = await wakeFixture(fixture);

        expect(await context.call(hand, "list_entries", {})).toMatchObject({ ok: false });
        expect(rowsOutsideTheLadder(await dumpObject(contextObjectOf(fixture)))).toEqual(before);
      }
    });

    test("a step that changes only the shape climbs, leaving every record as it was", async () => {
      addSteps(fixture.ids.context, (sql) => {
        sql.exec(`ALTER TABLE entries ADD COLUMN added_by_a_step TEXT`);
        sql.exec(`CREATE INDEX entries_by_words ON entries (words)`);
      });
      wakeUnder("release-adding-a-column");
      const { context } = await wakeFixture(fixture);

      expect((await ladderOf(contextObjectOf(fixture))).step).toBe(CONTEXT_LADDER.length + 1);
      expect(value(await context.call(hand, "list_entries", {})).items.length).toBeGreaterThan(0);
      // It noted the platform's bookmark before its first pending step, on the step it was saved on.
      expect(
        await runInDurableObject(contextObjectOf(fixture), (_, state) =>
          state.storage.sql.exec(`SELECT bookmark, bookmark_step FROM ladder`).one(),
        ),
      ).toEqual({ bookmark: expect.any(String), bookmark_step: savedStep(fixture) });
    });

    test("an object whose tables are newer than the code serves nothing", async () => {
      const { context } = await wakeFixture(fixture);
      await runInDurableObject(contextObjectOf(fixture), (_, state) => {
        state.storage.sql.exec(`UPDATE ladder SET step = step + 1`);
      });
      await wakeAgain(contextObjectOf(fixture));

      const refused = await context.call(hand, "list_entries", {});
      expect(refused.ok ? "" : refused.error.message).toMatch(
        `its tables stand on step ${CONTEXT_LADDER.length + 1} of its upgrade, newer than release unreleased knows`,
      );
    });

    test("a runtime that cannot open its tables leaves the Journal working, the Conversation unavailable", async () => {
      const { context } = await wakeFixture(fixture);
      await leaveRuntimeUnopenable(contextObjectOf(fixture));
      await wakeAgain(contextObjectOf(fixture));

      expect(value(await context.callAny(hand, "list_messages", {}))).toEqual({
        items: [],
        next_cursor: null,
        agent: "unavailable",
        voice: "available",
      });
      expect(await context.callAny(hand, "send_message", { words: "Hello?" })).toMatchObject({
        ok: false,
        error: { code: "refused" },
      });
      value(await context.call(hand, "record_entry", { words: "The Journal works" }));
      expect(value(await context.call(hand, "list_entries", {})).items.length).toBeGreaterThan(1);
    });
  },
);

/**
 * Leave a Context's object with runtime tables its runtime will not open, as a release whose
 * runtime does not know their version would: it keeps the version its own tables are at.
 */
async function leaveRuntimeUnopenable(stub: DurableObjectStub): Promise<void> {
  await runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    const [versions] = sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? AND name LIKE '%schema%'`,
        `${RUNTIME_TABLES}%`,
      )
      .toArray();
    if (versions === undefined) throw new Error("The runtime keeps no version of its tables");
    sql.exec(`UPDATE "${versions.name}" SET version = 99`);
  });
}

describe("clear_conversation, on a runtime that cannot open its tables", () => {
  test("mends the Conversation: it starts afresh, and the Agent answers again", async () => {
    const { deployment, id, context } = await contextWithItsDeployment(
      "2026-11-15T09:00:00.000Z",
      "Personal",
    );
    const messages = async () =>
      value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
    await context.callAny(hand, "send_message", { words: marked("Hello") });
    await context.runsEnded();
    await leaveRuntimeUnopenable(env.CONTEXT.get(env.CONTEXT.idFromString(id)));
    await deployment.wakeAgain(id);
    expect((await messages()).agent).toBe("unavailable");

    value(await context.call(hand, "clear_conversation", {}));

    expect(await messages()).toEqual({
      items: [],
      next_cursor: null,
      agent: "available",
      voice: "available",
    });
    value(await context.callAny(hand, "send_message", { words: marked("Hello again") }));
    await context.runsEnded();
    expect((await messages()).items.map(({ from }) => from)).toEqual(["agent", "person"]);
  });
});

describe("step 1, on a Context's object made before the ladder", () => {
  /** A new Context's object, made as one before the ladder was, by `before`, and woken again. */
  async function madeBeforeTheLadder(before: (sql: SqlStorage) => void) {
    const deployment = newDeployment();
    const { id } = await contextIn(deployment, "Old", { accent: "teal" });
    // Taken afresh each time: one held across the object woken again is broken.
    const stub = () => env.CONTEXT.get(env.CONTEXT.idFromString(id));
    await runInDurableObject(stub(), (_, state) => {
      const sql = state.storage.sql;
      before(sql);
      sql.exec(`DROP TABLE ladder`);
    });
    await wakeAgain(stub());
    return { stub, context: deployment.context(id) };
  }

  /** The columns of a table, in order. */
  function columnsOf(stub: DurableObjectStub, table: string) {
    return runInDurableObject(stub, (_, state) =>
      state.storage.sql
        .exec<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, table)
        .toArray()
        .map(({ name }) => name),
    );
  }

  test("gives the Run records the columns a Run made now writes", async () => {
    const fresh = await freshObjects();
    const { stub } = await madeBeforeTheLadder((sql) => {
      // The Run records before they said why a Run failed and where a Run trying a failed one
      // again starts.
      sql.exec(`DROP TABLE run_changes`);
      sql.exec(`DROP TABLE runs`);
      sql.exec(`CREATE TABLE runs (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, started_by TEXT NOT NULL, message TEXT,
        submission INTEGER, at INTEGER NOT NULL, model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0, ended TEXT)`);
    });

    expect(await columnsOf(stub(), "runs")).toEqual(await columnsOf(fresh.context, "runs"));
    expect((await ladderOf(stub())).step).toBe(CONTEXT_LADDER.length);
  });

  test("fills the words index from the records not in the Trash, once, and keeps it from then on", async () => {
    const { stub, context } = await madeBeforeTheLadder((sql) => {
      // The object as it was before: no words index, and nothing keeping one.
      for (const { name } of sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE ?`,
          `${WORDS_INDEX}%`,
        )
        .toArray()) {
        sql.exec(`DROP TRIGGER ${name}`);
      }
      sql.exec(`DROP TABLE ${WORDS_INDEX}`);
      sql.exec(`INSERT INTO entries (id, words, at, author_kind, through_conversation)
        VALUES ('e1', 'Before the index', 0, 'person', 0)`);
      sql.exec(`INSERT INTO tasks (id, title, origin_entry, at, author_kind)
        VALUES ('t1', 'A Task from before', 'e1', 0, 'person')`);
      sql.exec(`INSERT INTO projects (id, name, at) VALUES ('p1', 'A Project from before', 0)`);
      sql.exec(`INSERT INTO persons (id, name, at) VALUES ('s1', 'Someone from before', 0)`);
      sql.exec(`INSERT INTO persons (id, name, at) VALUES ('s2', 'Someone in the Trash', 0)`);
      sql.exec(
        `INSERT INTO trash_items (id, kind, record_id, at) VALUES ('i1', 'person', 's2', ?)`,
        Date.parse("2026-11-15T09:00:00.000Z"),
      );
      sql.exec(`INSERT INTO trashed (kind, record_id, item) VALUES ('person', 's2', 'i1')`);
    });
    value(await context.call(hand, "create_person", { name: "Someone after" }));

    const indexed = await runInDurableObject(stub(), (_, state) =>
      state.storage.sql
        .exec<{ record: string }>(
          `SELECT kind || ' ' || text AS record FROM ${WORDS_INDEX}
           WHERE ${WORDS_INDEX} MATCH 'before OR after' ORDER BY record`,
        )
        .toArray()
        .map(({ record }) => record),
    );
    expect(indexed).toEqual([
      "entry Before the index",
      "person Someone after",
      "person Someone from before",
      "project A Project from before",
      "task A Task from before",
    ]);
  });

  test("queues its whole Journal for the meaning index, so search answers from words until it is built", async () => {
    const { stub } = await madeBeforeTheLadder((sql) => {
      // The object as it was before: nothing of the meaning index, and nothing keeping it.
      for (const name of ["meaning_entry_made", "meaning_entry_changed", "meaning_entry_removed"]) {
        sql.exec(`DROP TRIGGER ${name}`);
      }
      for (const table of ["meaning_queue", "meaning_index", "meaning_spend"]) {
        sql.exec(`DROP TABLE ${table}`);
      }
      sql.exec(`INSERT INTO entries (id, words, at, author_kind, through_conversation)
        VALUES ('e1', 'Before the meaning index', 0, 'person', 0)`);
    });

    const queued = await runInDurableObject(stub(), (_, state) => ({
      queue: state.storage.sql.exec(`SELECT entry, what FROM meaning_queue`).toArray(),
      built: state.storage.sql.exec(`SELECT built FROM meaning_index`).one().built,
    }));
    expect(queued).toEqual({ queue: [{ entry: "e1", what: "embed" }], built: 0 });
  });
});

describe("step 1, on the Deployment object made before the ladder", () => {
  test("keeps the last Backup made as the one holding each Context, since every Backup held them all", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    const { record: made } = await contextIn(deployment, "Old", { accent: "teal" });
    await deployment.backUp();
    const stub = () => env.DEPLOYMENT.get(env.DEPLOYMENT.idFromString(deployment.id));
    await runInDurableObject(stub(), (_, state) => {
      const sql = state.storage.sql;
      sql.exec(`DROP TABLE contexts`);
      sql.exec(`CREATE TABLE contexts (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        accent TEXT NOT NULL, retired INTEGER NOT NULL)`);
      sql.exec(
        `INSERT INTO contexts (id, name, accent, retired) VALUES (?, 'Old', 'teal', 0)`,
        made.id,
      );
      sql.exec(`DROP TABLE ladder`);
    });
    await wakeAgain(stub());

    const backedUp = await runInDurableObject(stub(), (_, state) =>
      state.storage.sql.exec(`SELECT backed_up FROM contexts`).one(),
    );
    expect(backedUp).toEqual({ backed_up: Date.parse("2026-11-15T03:00:00.000Z") });
  });
});

describe("a Deployment object stuck on its upgrade", () => {
  test("is shown as one plain page saying under which release, for every request", async () => {
    const access = await fakeAccess(TEST_APPLICATION);
    const worker = praxis(() => access.setup());
    const screen = await access.sign(Date.now());
    const client = await access.sign(Date.now(), THROUGH_OAUTH);
    const send = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set(ACCESS_TOKEN_HEADER, path.startsWith("/mcp") ? client : screen);
      return worker.fetch(new Request(`https://praxis.test${path}`, { ...init, headers }), env);
    };
    // The one the Worker routes by, taken afresh each time it is woken again.
    const named = () => env.DEPLOYMENT.get(env.DEPLOYMENT.idFromName("deployment"));
    const id = named().id.toString();
    addSteps(id, failingStep);
    wakeUnder("release-with-a-bad-step");
    await wakeAgain(named());

    for (const [path, init] of [
      ["/", { headers: { "sec-fetch-mode": "navigate" } }],
      // A browser that names no fetch mode opens the screen by asking for HTML.
      ["/", { headers: { accept: "text/html,application/xhtml+xml" } }],
      ["/api/deployment/tools/list_contexts", { method: "POST", body: "{}" }],
      ["/mcp/someone", { method: "POST", body: "{}" }],
    ] as const) {
      const page = await send(path, init);
      expect(page.status).toBe(503);
      expect(page.headers.get("praxis-upgrade")).toBe("stuck");
      expect(await page.text()).toContain("release-with-a-bad-step");
    }
    expect((await ladderOf(named())).step).toBe(DEPLOYMENT_LADDER.length);

    // Mended under the next release, it routes again.
    mendSteps(id);
    wakeUnder("release-that-mends-it");
    await wakeAgain(named());
    expect(
      (await send("/api/deployment/tools/list_contexts", { method: "POST", body: "{}" })).status,
    ).toBe(200);
  });
});

describe("Pi 1.5.2's persisted pending generation", () => {
  test("resumes its Run and tool results after upgrade, keeping each write once", async () => {
    adoptMarkers(JSON.stringify(pending.context));
    const tasks = (pending.context.rows.pi_tasks ?? []).map(({ record }) => JSON.parse(record));
    expect(tasks).toContainEqual(
      expect.objectContaining({
        kind: "pi.generation",
        version: 2,
        state: expect.objectContaining({
          status: "running",
          checkpoint: expect.objectContaining({ phase: "request" }),
        }),
      }),
    );
    expect(pending.context.rows.pi_submissions[0]?.status).toBe("placed");
    const words = marked("After the upgrade");
    scriptModel(
      calling([
        () => {
          throw new Error("The completed tool result was lost");
        },
        () => ["record_entry", { words }],
      ]),
    );
    const object = () => env.CONTEXT.get(env.CONTEXT.idFromString(pending.contextId));
    holdMeanings(pending.contextId, pending.context.rows.entries);
    await layDump(
      env.DEPLOYMENT.get(env.DEPLOYMENT.idFromString(pending.deploymentId)),
      pending.deployment as Dump,
    );
    await layDump(object(), pending.context as Dump);
    const deployment = newDeployment(pending.at, pending.deploymentId);
    const context = deployment.context(pending.contextId);
    await context.callAny(hand, "list_messages", {});
    await context.runsEnded();
    const entries = value(await context.call(hand, "list_entries", {})).items;
    expect(entries.map(({ words }) => words).sort()).toEqual(
      [pending.context.rows.entries[0]?.words, words].sort(),
    );
    const runs = value(await context.call(hand, "list_runs", {})).items;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ended: "answered", failure: null });
    expect(runs[0]?.changes).toHaveLength(2);
    const migrated = (await dumpObject(object())).rows.pi_tasks?.map(({ record }) =>
      JSON.parse(String(record)),
    );
    expect(migrated).toContainEqual(
      expect.objectContaining({
        id: 14,
        kind: "pi.generation",
        version: 3,
        state: expect.objectContaining({ status: "terminal" }),
      }),
    );
    expect(migrated).toContainEqual(
      expect.objectContaining({
        kind: "pi.tool",
        version: 4,
        state: expect.objectContaining({ status: "terminal" }),
      }),
    );
    await deployment.wakeAgain(pending.contextId);
    expect(value(await context.call(hand, "list_entries", {})).items).toEqual(entries);
    expect(value(await context.call(hand, "list_runs", {})).items).toEqual(runs);
  });
});
