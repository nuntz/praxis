import { runInDurableObject } from "cloudflare:test";
import type { env } from "cloudflare:workers";
import {
  type Caller,
  type Change,
  type Effect,
  instantToIso,
  isWrite,
  keysForgottenBy,
  type ToolResult,
} from "@praxis/domain";
import { expect } from "vitest";

// The oracle (ADR 0015), the one place tests read tables. It snapshots the Context's domain
// tables before and after each call, and fails unless the difference is exactly the Effects the
// call returned and the change log holds the same Effects with the right caller. Any other call
// (a read, a failure, a repeated key) changes no record and logs nothing.

type Stub = ReturnType<typeof env.CONTEXT.get>;

export type Request = { caller: Caller; tool: string; input: unknown; arrivedAt: number };

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
  context_settings: { kind: "context", id: "id" },
};

/** The Context object's other tables, which hold no record. */
const otherTables = ["change_calls", "changes", "write_keys"];

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

/** Each record made, changed or deleted between two snapshots. */
function differences(before: Records, after: Records): Pick<Effect, "kind" | "id" | "what">[] {
  const found: Pick<Effect, "kind" | "id" | "what">[] = [];
  for (const record of new Set([...before.keys(), ...after.keys()])) {
    const [kind, id] = record.split(/:(.*)/s) as [Effect["kind"], string];
    const was = before.get(record);
    const is = after.get(record);
    if (was === is) continue;
    const what = was === undefined ? "made" : is === undefined ? "deleted" : "changed";
    found.push({ kind, id, what });
  }
  return found;
}

function snapshot(stub: Stub): Promise<{ records: Records; lastChange: number }> {
  return runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    const tables = sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
      )
      .toArray()
      .map((row) => row.name);
    const unknown = tables.filter((name) => !(name in domainTables || otherTables.includes(name)));
    expect(
      unknown,
      "Every table is known to the oracle: add it to domainTables in apps/worker/test/oracle.ts if its rows are records, else to otherTables",
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
    const { seq } = sql
      .exec<{ seq: number | null }>(`SELECT max(seq) AS seq FROM change_calls`)
      .one();
    return { records, lastChange: seq ?? 0 };
  });
}

/** The change log's calls after `seq`, read from its tables rather than through `list_changes`. */
function changesSince(stub: Stub, seq: number): Promise<Change[]> {
  type CallRow = {
    seq: number;
    at: number;
    caller_kind: Caller["kind"];
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
        caller: (call.caller_name === null
          ? { kind: call.caller_kind }
          : { kind: call.caller_kind, name: call.caller_name }) as Caller,
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
  const by = "name" in caller ? `${caller.kind}:${caller.name}` : caller.kind;
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
