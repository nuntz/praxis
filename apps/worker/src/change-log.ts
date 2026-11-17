import {
  type Caller,
  type Change,
  changesPrunedBy,
  type Effect,
  instantToIso,
} from "@praxis/domain";

/** Put one write's Effects in the change log, with its caller and when it arrived. */
export function appendChange(
  sql: SqlStorage,
  change: { at: number; caller: Caller; tool: string; effects: Effect[] },
): void {
  const { caller } = change;
  const { seq } = sql
    .exec<{ seq: number }>(
      `INSERT INTO change_calls (at, caller_kind, caller_id, caller_name, tool)
       VALUES (?, ?, ?, ?, ?)
       RETURNING seq`,
      change.at,
      caller.kind,
      "id" in caller ? caller.id : null,
      "id" in caller ? caller.name : null,
      change.tool,
    )
    .one();
  change.effects.forEach((effect, ord) => {
    sql.exec(
      `INSERT INTO changes (call, ord, kind, record_id, what, summary, by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seq,
      ord,
      effect.kind,
      effect.id,
      effect.what,
      effect.summary,
      effect.by,
    );
  });
}

/** Where the change log stands: the number of the last change in it, or pruned from it. */
export function lastChange(sql: SqlStorage): number {
  const { seq } = sql
    .exec<{ seq: number | null }>(`SELECT max(seq) AS seq FROM change_calls`)
    .one();
  return Math.max(seq ?? 0, prunedThrough(sql));
}

/** The number of the last change pruned from the log, or 0 when none has been. */
export function prunedThrough(sql: SqlStorage): number {
  return (
    sql.exec<{ through: number }>(`SELECT through FROM change_log_pruned`).toArray()[0]?.through ??
    0
  );
}

/**
 * The changes after `after`, oldest first, at most `limit` of them, and whether more follow. The
 * one reading of the log, for `list_changes` and for what the live channel carries.
 */
export function changesAfter(
  sql: SqlStorage,
  after: number,
  limit: number,
): { items: Change[]; last: number; more: boolean } {
  // One more than asked for is read to learn whether more follow.
  const calls = sql
    .exec<CallRow>(
      `SELECT * FROM change_calls WHERE seq > ? ORDER BY seq LIMIT ?`,
      after,
      limit + 1,
    )
    .toArray();
  const page = calls.slice(0, limit);
  const last = page.at(-1)?.seq ?? after;
  const effects = Map.groupBy(
    sql
      .exec<EffectRow>(
        `SELECT * FROM changes WHERE call > ? AND call <= ? ORDER BY call, ord`,
        after,
        last,
      )
      .toArray(),
    (row) => row.call,
  );
  return {
    items: page.map((call) => toChange(call, effects.get(call.seq) ?? [])),
    last,
    more: calls.length > limit,
  };
}

/** Drop each change 90 days old by `at`, remembering how far the log has been pruned. */
export function pruneChanges(sql: SqlStorage, at: number): void {
  const { through } = sql
    .exec<{ through: number | null }>(
      `SELECT max(seq) AS through FROM change_calls WHERE at <= ?`,
      changesPrunedBy(at),
    )
    .one();
  if (through === null) return;
  sql.exec(`DELETE FROM changes WHERE call <= ?`, through);
  sql.exec(`DELETE FROM change_calls WHERE seq <= ?`, through);
  sql.exec(
    `INSERT INTO change_log_pruned (id, through) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET through = excluded.through`,
    through,
  );
}

/** Whether the log holds any change, so there is something left to prune. */
export function holdsChanges(sql: SqlStorage): boolean {
  return sql.exec(`SELECT 1 FROM change_calls LIMIT 1`).toArray().length > 0;
}

/** A cursor into the change log, standing after the change with this number. */
export function encodeCursor(seq: number): string {
  return btoa(JSON.stringify(["changes", seq]));
}

/** The number a cursor this log gave stands after, or null for any other string. */
export function decodeCursor(cursor: string): number | null {
  try {
    const value: unknown = JSON.parse(atob(cursor));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value[0] === "changes" &&
      Number.isSafeInteger(value[1]) &&
      value[1] >= 0
    ) {
      return value[1];
    }
  } catch {
    // Not base64 or not JSON: not a cursor this list gave.
  }
  return null;
}

type CallRow = {
  seq: number;
  at: number;
  caller_kind: Caller["kind"];
  caller_id: string | null;
  caller_name: string | null;
  tool: string;
};

type EffectRow = {
  call: number;
  kind: Effect["kind"];
  record_id: string;
  what: Effect["what"];
  summary: string;
  by: Effect["by"];
};

function toChange(call: CallRow, effects: EffectRow[]): Change {
  return {
    at: instantToIso(call.at),
    caller: toCaller(call),
    tool: call.tool,
    effects: effects.map((row) => ({
      kind: row.kind,
      id: row.record_id,
      what: row.what,
      summary: row.summary,
      by: row.by,
    })),
  };
}

function toCaller(row: CallRow): Caller {
  switch (row.caller_kind) {
    case "connection":
    case "read_only_connection":
      return { kind: row.caller_kind, id: row.caller_id ?? "", name: row.caller_name ?? "" };
    default:
      return { kind: row.caller_kind };
  }
}
