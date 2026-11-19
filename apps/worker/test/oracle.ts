import { runInDurableObject } from "cloudflare:test";
import type { env } from "cloudflare:workers";
import {
  type Caller,
  type Change,
  DEFAULT_SPEND_CAP,
  type Effect,
  instantToIso,
  isConversationToolName,
  isHeld,
  isWrite,
  keysForgottenBy,
  SPEND_CAP_ID,
  type ToolResult,
} from "@praxis/domain";
import { expect } from "vitest";
import { RUNTIME_TABLES } from "../src/agent.ts";
import { REFERENCES_CLEARED } from "../src/trash-rows.ts";
import { markersIn } from "./markers.ts";

// The oracle (ADR 0015), the one place tests read tables. It snapshots the Context's domain
// tables before and after each call, and fails unless the difference is exactly the Effects the
// call returned and the change log holds the same Effects with the right caller. Any other call
// (a read, a failure, a repeated key) changes no record and logs nothing.

type Stub = ReturnType<typeof env.CONTEXT.get>;

export type Request = {
  caller: Caller;
  tool: string;
  input: unknown;
  arrivedAt: number;
  /** The Device the screen called from, for a Deployment tool. */
  device?: string;
};

/**
 * Each domain table, with the kind of thing an Effect names that its rows belong to (a record, or
 * the Context's own settings) and the column holding its id. A record can span tables: a Task is
 * its row and its events.
 */
const domainTables: Record<string, { kind: Effect["kind"]; id: string }> = {
  entries: { kind: "entry", id: "id" },
  tasks: { kind: "task", id: "id" },
  task_events: { kind: "task", id: "task" },
  projects: { kind: "project", id: "id" },
  project_events: { kind: "project", id: "project" },
  persons: { kind: "person", id: "id" },
  entry_links: { kind: "entry", id: "entry" },
  entry_versions: { kind: "entry", id: "entry" },
  standing_marks: { kind: "entry", id: "entry" },
  context_settings: { kind: "context", id: "id" },
  // Not a record, but leaving one, making it, cancelling it and its lapsing are each an Effect.
  held_changes: { kind: "held_change", id: "id" },
};

/**
 * The Trash's tables (section 3.8). They hold which records are in the Trash, which the oracle
 * reads to see each as a caller does: a record sent there is deleted, and one restored is made
 * again. A record in the Trash cannot change, so what it holds while there is not compared.
 */
const trashTables = ["trash_items", "trashed", "dormant_links"];

/** What a record in the Trash is in a snapshot, whatever its rows hold. */
const IN_THE_TRASH = "in the Trash";

/** The tables holding a record's own row, which a removal for good takes. */
const RECORD_TABLES = ["entries", "tasks", "projects", "persons"];

/** The Context object's other tables, which hold no record. */
const otherTables = [
  "change_calls",
  "changes",
  "change_log_pruned",
  "write_keys",
  // Run records, which hold no words and no record.
  "runs",
  "run_changes",
  // When the clock last started a Brief and a Review, which holds no record.
  "clock_schedule",
];

/** Each record's rows as JSON, by `kind:id`. */
export type Records = Map<string, string>;

export type Seen = {
  request: Request;
  result: ToolResult<unknown>;
  before: Records;
  after: Records;
  /** What the change log gained in the call. */
  logged: Change[];
  /** The first result of an earlier call with the same key by the same caller, if remembered. */
  firstWithKey: ToolResult<unknown> | null;
  /**
   * The words of each record, in the Trash or not, by `kind:id`, before and after the call, and
   * the change log's summaries after it: a record removed for good leaves none of its words there.
   */
  words?: { before: Map<string, string>; after: Map<string, string>; log: string[] };
};

/** Call a tool through the oracle, failing the test on anything it finds. */
export async function throughOracle(stub: Stub, request: Request): Promise<ToolResult<unknown>> {
  const before = await snapshot(stub);
  const firstWithKey = await rememberedResult(stub, request);
  const result = await stub.call(request);
  const after = await snapshot(stub);
  const logged = await changesSince(stub, before.lastChange);

  const problems = judge({
    request,
    result,
    before: before.records,
    after: after.records,
    logged,
    firstWithKey,
    words: { before: before.words, after: after.words, log: after.summaries },
  });
  expect(problems, `The oracle, on ${request.tool} as ${request.caller.kind}`).toEqual([]);
  return result;
}

/** What is wrong with one call as the oracle saw it. Nothing, when the call kept its word. */
export function judge(seen: Seen): string[] {
  const { request, result, logged, firstWithKey } = seen;
  const changed = differences(seen.before, seen.after);
  const problems: string[] = [];

  if (firstWithKey !== null && !same(result, firstWithKey)) {
    problems.push("A repeated key did not return the first result.");
  }
  problems.push(...wordsLeftBehind(seen));
  if (isConversationToolName(request.tool)) return judgeConversation(changed, logged);
  const write = isWrite(request.tool);
  if (!write || !result.ok || firstWithKey !== null) {
    const why = !write ? "A read" : !result.ok ? "A call that failed" : "A repeated key";
    if (changed.length > 0) problems.push(`${why} changed records: ${canonical(changed)}`);
    if (logged.length > 0) problems.push(`${why} added to the change log.`);
    return problems;
  }

  const { effects, changed: says } = result.value as { effects: Effect[]; changed: boolean };
  const named = effects.map(({ kind, id, what }) => ({ kind, id, what }));
  if (!same(sorted(changed), sorted(named))) {
    problems.push(
      `The records changed are not the Effects returned. Changed: ${canonical(sorted(changed))}. Effects: ${canonical(sorted(named))}.`,
    );
  }
  // A held call changes nothing but the Held Change it leaves (section 13), whatever it reports.
  if (isHeld(result.value as object)) {
    const others = changed.filter(({ kind }) => kind !== "held_change");
    const left = changed.filter(({ kind, what }) => kind === "held_change" && what === "made");
    if (others.length > 0 || left.length !== 1) {
      problems.push(
        `A held call changes nothing but its Held Change, yet changed: ${canonical(sorted(changed))}.`,
      );
    }
  }
  if (says !== effects.length > 0) {
    problems.push("The result does not say whether anything changed.");
  }
  const expected: Change[] =
    effects.length === 0
      ? []
      : [
          {
            at: instantToIso(request.arrivedAt),
            caller: request.caller,
            tool: request.tool,
            effects,
          },
        ];
  if (!same(logged, expected)) {
    problems.push(
      `The change log does not hold the same Effects with the caller. Logged: ${canonical(logged)}.`,
    );
  }
  return problems;
}

/**
 * Words of a record removed for good that the change log still holds (section 3.8): nothing of it
 * is left, and the log keeps only what kind of record changed and by whom. Seen by the markers in
 * its words, so an Effect quoting them under another id, as of a Held Change, is caught too.
 */
function wordsLeftBehind({ words }: Seen): string[] {
  if (!words) return [];
  const removed = [...words.before].filter(([record]) => !words.after.has(record));
  return removed
    .filter(([, text]) =>
      markersIn(text).some((marker) => words.log.some((summary) => summary.includes(marker))),
    )
    .map(
      ([record]) =>
        `The change log keeps words of a record removed for good: ${record}. Blank every summary quoting them.`,
    );
}

/**
 * A Conversation tool changes no domain table and logs nothing (section 4.12). A Run it starts
 * goes on after it answers and can change records while the oracle looks, but only through the
 * Context tools the Agent calls: whatever changed must be named by the Effects the Agent's calls
 * logged, and the log gains nothing from any other caller.
 */
function judgeConversation(changed: Pick<Effect, "kind" | "id" | "what">[], logged: Change[]) {
  const problems: string[] = [];
  const others = logged.filter((change) => change.caller.kind !== "agent");
  if (others.length > 0) {
    problems.push(`A Conversation tool added to the change log: ${canonical(others)}`);
  }
  const named = new Set(
    logged.flatMap((change) => change.effects.map(({ kind, id }) => `${kind}:${id}`)),
  );
  const unreported = changed.filter(({ kind, id }) => !named.has(`${kind}:${id}`));
  if (unreported.length > 0) {
    problems.push(
      `A Conversation tool changed records no Agent call reported: ${canonical(unreported)}`,
    );
  }
  return problems;
}

// The same promise for a Deployment write, which can reach into a Context's object (to make it or
// rename it): every Context listed is snapshotted before and after, and what changed in each must
// be Effects the call returned, logged in that Context with the caller. A Context the call made
// holds its settings and nothing else, and its change log starts empty. The Connections, the
// Devices and the spend cap the Deployment object keeps are held the same way: the ones changed
// are exactly the ones its Effects name, and the Deployment object keeps no change log for them.
// When a Device was last seen is a sighting, not a change, and is left out.

type DeploymentStub = ReturnType<typeof env.DEPLOYMENT.get>;

/** One Context as a Deployment write found it: before (null when the call made it) and after. */
export type SeenContext = { before: Records | null; after: Records; logged: Change[] };

export type SeenDeployment = {
  request: Request;
  result: ToolResult<unknown>;
  contexts: Map<string, SeenContext>;
  /**
   * What the Deployment object keeps other than its Contexts, its Connections and its spend cap,
   * each as a record is, before and after the call.
   */
  kept: { before: Records; after: Records };
};

/** Call a Deployment tool through the oracle, failing the test on anything it finds. */
export async function throughDeploymentOracle(
  deployment: DeploymentStub,
  contextOf: (id: string) => Stub,
  request: Request,
): Promise<ToolResult<unknown>> {
  const listedBefore = await listedContexts(deployment);
  const before = new Map<string, { records: Records; lastChange: number }>();
  for (const id of listedBefore) before.set(id, await snapshot(contextOf(id)));
  const keptBefore = await keptByDeployment(deployment);
  const result = await deployment.call(request);
  const listedAfter = await listedContexts(deployment);
  const kept = { before: keptBefore, after: await keptByDeployment(deployment) };

  const contexts = new Map<string, SeenContext>();
  for (const id of listedAfter) {
    const stub = contextOf(id);
    const was = before.get(id);
    const after = await snapshot(stub);
    const logged = await changesSince(stub, was?.lastChange ?? 0);
    contexts.set(id, { before: was?.records ?? null, after: after.records, logged });
  }
  const gone = listedBefore.filter((id) => !listedAfter.includes(id));

  const problems = [
    ...gone.map((id) => `The Context ${id} left the list.`),
    ...judgeDeployment({ request, result, contexts, kept }),
  ];
  expect(problems, `The oracle, on ${request.tool} as ${request.caller.kind}`).toEqual([]);
  return result;
}

/** What is wrong with one Deployment call as the oracle saw each Context. */
export function judgeDeployment(seen: SeenDeployment): string[] {
  const { request, result } = seen;
  const effects = result.ok ? ((result.value as { effects?: Effect[] }).effects ?? []) : [];
  const problems: string[] = [];

  const keptChanged = differences(seen.kept.before, seen.kept.after);
  const onKept = effects
    .filter((e) => e.kind === "connection" || e.kind === "device" || e.kind === "spend_cap")
    .map(({ kind, id, what }) => ({ kind, id, what }));
  if (!same(sorted(keptChanged), sorted(onKept))) {
    problems.push(
      `The Connections, Devices and cap changed are not the Effects on them returned. Changed: ${canonical(sorted(keptChanged))}. Effects: ${canonical(sorted(onKept))}.`,
    );
  }

  for (const [id, { before, after, logged }] of seen.contexts) {
    if (before === null) {
      const made = differences(new Map(), after);
      if (!same(made, [{ kind: "context", id, what: "made" }])) {
        problems.push(`The Context made holds more than its settings: ${canonical(made)}`);
      }
      if (!effects.some((e) => e.kind === "context" && e.id === id && e.what === "made")) {
        problems.push(`The Context ${id} was made with no Effect saying so.`);
      }
      if (logged.length > 0)
        problems.push(`The change log of the Context made does not start empty.`);
      continue;
    }

    const changed = differences(before, after);
    if (!result.ok && changed.length > 0) {
      problems.push(`A call that failed changed the Context ${id}: ${canonical(changed)}`);
      continue;
    }
    const unreported = changed.filter(
      (c) => !effects.some((e) => e.kind === c.kind && e.id === c.id && e.what === c.what),
    );
    if (unreported.length > 0) {
      problems.push(`The Context ${id} changed with no Effect saying so: ${canonical(unreported)}`);
    }
    const inThisContext = effects.filter((e) =>
      changed.some((c) => c.kind === e.kind && c.id === e.id),
    );
    const expected: Change[] =
      inThisContext.length === 0
        ? []
        : [
            {
              at: instantToIso(request.arrivedAt),
              caller: request.caller,
              tool: request.tool,
              effects: inThisContext,
            },
          ];
    if (!same(logged, expected)) {
      problems.push(
        `The change log of the Context ${id} does not hold what changed in it, with the caller. Logged: ${canonical(logged)}.`,
      );
    }
  }
  return problems;
}

/** The ids of the Contexts the Deployment object lists, read from its table. */
function listedContexts(deployment: DeploymentStub): Promise<string[]> {
  return runInDurableObject(deployment, (_, state) =>
    state.storage.sql
      .exec<{ id: string }>(`SELECT id FROM contexts ORDER BY seq`)
      .toArray()
      .map((row) => row.id),
  );
}

/**
 * The Deployment object's tables whose rows an Effect names, each read as records are, by
 * `kind:id`. A Device is read without when it was last seen, a sighting and not a change, and the
 * spend cap is always there: before the person sets one, the default.
 */
const keptDeploymentTables: Record<string, (sql: SqlStorage) => [string, string][]> = {
  connections: (sql) =>
    [...sql.exec<{ id: string }>(`SELECT * FROM connections ORDER BY seq`)].map((row) => [
      `connection:${row.id}`,
      canonical(row),
    ]),
  devices: (sql) =>
    [...sql.exec<{ id: string; seen?: number }>(`SELECT * FROM devices ORDER BY seq`)].map(
      ({ seen: _, ...row }) => [`device:${row.id}`, canonical(row)],
    ),
  spend_cap: (sql) => {
    const set = sql.exec<{ dollars: number }>(`SELECT dollars FROM spend_cap`).toArray()[0];
    return [
      [`spend_cap:${SPEND_CAP_ID}`, canonical({ dollars: set?.dollars ?? DEFAULT_SPEND_CAP })],
    ];
  },
};

/**
 * The Deployment object's other tables, whose rows no Effect names: the list of Contexts, held to
 * what changed in each Context instead; what each Context spent and whether the key is refused,
 * which Runs report; and the keys of the writes made to it.
 */
const otherDeploymentTables = ["contexts", "spend", "key_refused", "write_keys"];

/**
 * What the Deployment object keeps that Effects name, as records are, failing the test when it
 * holds a table the oracle does not know, so a new one is never left unchecked.
 */
function keptByDeployment(deployment: DeploymentStub): Promise<Records> {
  return runInDurableObject(deployment, (_, state) => {
    const sql = state.storage.sql;
    const unknown = tablesIn(sql).filter(
      (name) => !(name in keptDeploymentTables || otherDeploymentTables.includes(name)),
    );
    expect(
      unknown,
      "Every table of the Deployment object is known to the oracle: add it to keptDeploymentTables in apps/worker/test/oracle.ts if an Effect names its rows, else to otherDeploymentTables",
    ).toEqual([]);
    return new Map(Object.values(keptDeploymentTables).flatMap((read) => read(sql)));
  });
}

/** An object's own tables, leaving out SQLite's and the platform's. */
function tablesIn(sql: SqlStorage): string[] {
  return sql
    .exec<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    )
    .toArray()
    .map((row) => row.name);
}

/** Each record made, changed or deleted between two snapshots. */
function differences(before: Records, after: Records): Pick<Effect, "kind" | "id" | "what">[] {
  const found: Pick<Effect, "kind" | "id" | "what">[] = [];
  for (const record of new Set([...before.keys(), ...after.keys()])) {
    const [kind, id] = record.split(/:(.*)/s) as [Effect["kind"], string];
    const was = before.get(record);
    const is = after.get(record);
    if (was === is) continue;
    // Sent to the Trash is deleted, as a caller sees it, and so is removed for good from it.
    // Brought back from it is made again.
    const what =
      is === undefined || is === IN_THE_TRASH
        ? "deleted"
        : was === undefined || was === IN_THE_TRASH
          ? "made"
          : "changed";
    found.push({ kind, id, what });
  }
  return found;
}

/** Each record's words, title or name, read from its own table, by `kind:id`. */
const SAID = `
  SELECT 'entry:' || id AS record, words AS text FROM entries
  UNION ALL SELECT 'task:' || id, title FROM tasks
  UNION ALL SELECT 'project:' || id, name FROM projects
  UNION ALL SELECT 'person:' || id, name FROM persons`;

function snapshot(stub: Stub): Promise<{
  records: Records;
  lastChange: number;
  words: Map<string, string>;
  summaries: string[];
}> {
  return runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    const tables = tablesIn(sql);
    const unknown = tables.filter(
      (name) =>
        !(
          name in domainTables ||
          trashTables.includes(name) ||
          otherTables.includes(name) ||
          name.startsWith(RUNTIME_TABLES)
        ),
    );
    expect(
      unknown,
      "Every table is known to the oracle: add it to domainTables in apps/worker/test/oracle.ts if its rows are records, else to otherTables",
    ).toEqual([]);
    // A record removed for good leaves no reference to it behind, which the foreign keys refuse.
    const uncleared = tables.flatMap((table) =>
      sql
        .exec<{ table: string; from: string }>(`SELECT * FROM pragma_foreign_key_list(?)`, table)
        .toArray()
        .filter((key) => RECORD_TABLES.includes(key.table))
        .map((key) => `${table}.${key.from}`)
        .filter((column) => !(column in REFERENCES_CLEARED)),
    );
    expect(
      uncleared,
      "Every column referencing a record is cleared when it is removed for good: clear it in removeForGood and list it in REFERENCES_CLEARED in apps/worker/src/trash-rows.ts",
    ).toEqual([]);

    const rows = new Map<string, Record<string, unknown[]>>();
    for (const [table, { kind, id }] of Object.entries(domainTables)) {
      for (const row of sql.exec(`SELECT * FROM ${table} ORDER BY rowid`)) {
        const record = `${kind}:${row[id]}`;
        const held = rows.get(record) ?? {};
        held[table] = [...(held[table] ?? []), row];
        rows.set(record, held);
      }
    }
    const records: Records = new Map(
      [...rows].map(([record, tables]) => [record, canonical(tables)]),
    );
    for (const row of sql.exec<{ kind: string; record_id: string }>(`SELECT * FROM trashed`)) {
      records.set(`${row.kind}:${row.record_id}`, IN_THE_TRASH);
    }
    const { seq } = sql
      .exec<{ seq: number | null }>(`SELECT max(seq) AS seq FROM change_calls`)
      .one();
    const words = new Map(
      sql
        .exec<{ record: string; text: string }>(SAID)
        .toArray()
        .map((row) => [row.record, row.text]),
    );
    const summaries = sql
      .exec<{ summary: string }>(`SELECT summary FROM changes`)
      .toArray()
      .map((row) => row.summary);
    return { records, lastChange: seq ?? 0, words, summaries };
  });
}

/** The change log's calls after `seq`, read from its tables rather than through `list_changes`. */
function changesSince(stub: Stub, seq: number): Promise<Change[]> {
  type CallRow = {
    seq: number;
    at: number;
    caller_kind: Caller["kind"];
    caller_id: string | null;
    caller_name: string | null;
    tool: string;
  };
  type EffectRow = {
    kind: Effect["kind"];
    record_id: string;
    what: Effect["what"];
    summary: string;
    by: Effect["by"];
  };
  return runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    return sql
      .exec<CallRow>(`SELECT * FROM change_calls WHERE seq > ? ORDER BY seq`, seq)
      .toArray()
      .map((call) => ({
        at: instantToIso(call.at),
        caller: (call.caller_id === null
          ? { kind: call.caller_kind }
          : { kind: call.caller_kind, id: call.caller_id, name: call.caller_name }) as Caller,
        tool: call.tool,
        effects: sql
          .exec<EffectRow>(`SELECT * FROM changes WHERE call = ? ORDER BY ord`, call.seq)
          .toArray()
          .map((row) => ({
            kind: row.kind,
            id: row.record_id,
            what: row.what,
            summary: row.summary,
            by: row.by,
          })),
      }));
  });
}

/** The first result of a call this caller already made with this key, while it is remembered. */
function rememberedResult(stub: Stub, request: Request): Promise<ToolResult<unknown> | null> {
  const key = (request.input as { key?: unknown } | null)?.key;
  if (typeof key !== "string") return Promise.resolve(null);
  const { caller } = request;
  // A Connection's keys are its own by its id, whatever its name and whether it reads only.
  const by = "id" in caller ? `connection:${caller.id}` : caller.kind;
  return runInDurableObject(stub, (_, state) => {
    const row = state.storage.sql
      .exec<{ tool: string; result: string }>(
        `SELECT tool, result FROM write_keys WHERE caller = ? AND key = ? AND at > ?`,
        by,
        key,
        keysForgottenBy(request.arrivedAt),
      )
      .toArray()[0];
    return row && row.tool === request.tool ? JSON.parse(row.result) : null;
  });
}

function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function sorted<T>(items: T[]): T[] {
  return items.toSorted((a, b) => canonical(a).localeCompare(canonical(b)));
}

/** JSON with every object's keys in order, so equal values give equal text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}
