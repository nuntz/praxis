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
  return {
    items: withEffects(sql, page),
    last: page.at(-1)?.seq ?? after,
    more: calls.length > limit,
  };
}

/**
 * The changes a Run made that the log still keeps, oldest first, with how many it made that the
 * log no longer keeps, pruned at 90 days (section 5.8).
 */
export function changesOfRun(sql: SqlStorage, run: string): { kept: Change[]; gone: number } {
  const calls = sql
    .exec<CallRow>(
      `SELECT c.* FROM run_changes r JOIN change_calls c ON c.seq = r.change
       WHERE r.run = ? ORDER BY c.seq`,
      run,
    )
    .toArray();
  const { made } = sql
    .exec<{ made: number }>(`SELECT count(*) AS made FROM run_changes WHERE run = ?`, run)
    .one();
  return { kept: withEffects(sql, calls), gone: made - calls.length };
}

/** Each call as a change, with its Effects in order. */
function withEffects(sql: SqlStorage, calls: CallRow[]): Change[] {
  const first = calls[0]?.seq;
  const last = calls.at(-1)?.seq;
  if (first === undefined || last === undefined) return [];
  const effects = Map.groupBy(
    sql
      .exec<EffectRow>(
        `SELECT * FROM changes WHERE call >= ? AND call <= ? ORDER BY call, ord`,
        first,
        last,
      )
      .toArray(),
    (row) => row.call,
  );
  return calls.map((call) => toChange(call, effects.get(call.seq) ?? []));
}

/**
 * What the Agent is told changed since the last Message it answered (section 4.4): the newest changes a caller
 * other than the Agent made after `after`, oldest first, how many earlier ones are left out, and
 * through where the log was read, where it stands now. Its own changes are in its Runs' calls.
 * `told` is false when it was never told before, and the digest is then of the newest changes.
 */
export type Digest = {
  items: Change[];
  earlier: number;
  after: number;
  through: number;
  /** Whether some changes after `after` were pruned from the log before they could be told. */
  pruned: boolean;
  told: boolean;
};

/** The digest of the changes others made after `after`, or of the newest when it is null. */
export function changesByOthers(sql: SqlStorage, after: number | null, limit: number): Digest {
  const from = after ?? 0;
  const calls = sql
    .exec<CallRow>(
      `SELECT * FROM change_calls WHERE seq > ? AND caller_kind != 'agent' ORDER BY seq DESC LIMIT ?`,
      from,
      limit,
    )
    .toArray()
    .toReversed();
  const { count } = sql
    .exec<{ count: number }>(
      `SELECT count(*) AS count FROM change_calls WHERE seq > ? AND caller_kind != 'agent'`,
      from,
    )
    .one();
  return {
    items: withEffects(sql, calls),
    earlier: count - calls.length,
    after: from,
    through: lastChange(sql),
    pruned: after !== null && after < prunedThrough(sql),
    told: after !== null,
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
