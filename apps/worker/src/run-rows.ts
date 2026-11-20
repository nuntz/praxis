import { monthBounds, type RunEnd, type RunFailure, type RunStart } from "@praxis/domain";
import { embeddedInMonth } from "./meaning-rows.ts";

/** A Run record as the Context's object keeps it (section 5.8). It holds no words. */
export type RunRow = {
  id: string;
  started_by: RunStart;
  message: string | null;
  submission: number | null;
  at: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number;
  ended: RunEnd | null;
  failure: RunFailure | null;
  from_record: number | null;
  told_through: number | null;
  /** For a Brief or a Review once ended: whether it left a Message. */
  raised: 0 | 1 | null;
  /** Whether a newer one of its kind replaced it while unread. */
  replaced: 0 | 1;
  /** When Praxis first showed it, for a Brief or a Review. */
  read_at: number | null;
  /** The ids of the Tasks a Brief or a Review names, as JSON. */
  tasks_named: string | null;
};

/** What a Run spent: its tokens, and their cost by the price table shipped with the code. */
export type RunSpend = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

/**
 * Keep the record of a Run as it starts, before the runtime runs anything. A Run trying a failed
 * one again says from which of the runtime's records it may be its own; one answering a new
 * Message, where the change log stood when the Agent was told what changed.
 */
export function startRun(
  sql: SqlStorage,
  run: {
    startedBy: RunStart;
    message: string;
    submission: number;
    at: number;
    model: string;
    fromRecord?: number;
    toldThrough?: number;
  },
): RunRow {
  return sql
    .exec<RunRow>(
      `INSERT INTO runs (id, started_by, message, submission, at, model, from_record, told_through)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      crypto.randomUUID(),
      run.startedBy,
      run.message,
      run.submission,
      run.at,
      run.model,
      run.fromRecord ?? null,
      run.toldThrough ?? null,
    )
    .one();
}

/**
 * The number of the change the Agent was last told the log stood at, with the newest Message it
 * was given, or null when it has never been told.
 */
export function lastToldChange(sql: SqlStorage): number | null {
  return sql.exec<{ through: number | null }>(`SELECT max(told_through) AS through FROM runs`).one()
    .through;
}

/**
 * Keep the record of a Run not started because the month's spend had reached the cap (section
 * 5.8): no Message was kept for it to answer, and it spent nothing. `list_runs` (#69) lists it.
 * The clock's says it was a Brief or a Review.
 */
export function recordRunNotStarted(
  sql: SqlStorage,
  run: { at: number; model: string; startedBy?: RunStart },
): void {
  sql.exec(
    `INSERT INTO runs (id, started_by, at, model, ended) VALUES (?, ?, ?, ?, 'cap_reached')`,
    crypto.randomUUID(),
    run.startedBy ?? "message",
    run.at,
    run.model,
  );
}

/**
 * Say how a Run ended, why if it failed, and what its answers spent, on top of what it spent
 * while going: a compaction summary written in it.
 */
export function endRun(
  sql: SqlStorage,
  id: string,
  ended: { how: RunEnd; failure: RunFailure | null },
  spend: RunSpend,
): void {
  addRunSpend(sql, id, spend);
  sql.exec(
    `UPDATE runs SET ended = ?, failure = ? WHERE id = ? AND ended IS NULL`,
    ended.how,
    ended.failure,
    id,
  );
}

/** Count what a Run spent while going, beside its answers: a compaction summary written in it. */
export function addRunSpend(sql: SqlStorage, id: string, spend: RunSpend): void {
  sql.exec(
    `UPDATE runs SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
       cache_read_tokens = cache_read_tokens + ?, cache_write_tokens = cache_write_tokens + ?,
       cost = cost + ?
     WHERE id = ? AND ended IS NULL`,
    spend.input,
    spend.output,
    spend.cacheRead,
    spend.cacheWrite,
    spend.cost,
    id,
  );
}

/** The Run started for the runtime's submission of a Message, if any. */
export function runAnswering(sql: SqlStorage, submission: number | undefined): RunRow | null {
  if (submission === undefined) return null;
  return (
    sql.exec<RunRow>(`SELECT * FROM runs WHERE submission = ?`, submission).toArray()[0] ?? null
  );
}

/** Every Run that has not ended, oldest first: after a restart, each is waited on again. */
export function runsNotEnded(sql: SqlStorage): RunRow[] {
  return sql.exec<RunRow>(`SELECT * FROM runs WHERE ended IS NULL ORDER BY seq`).toArray();
}

/** Note that a Run made the change the log numbers `change`. */
export function addRunChange(sql: SqlStorage, run: string, change: number): void {
  sql.exec(`INSERT OR IGNORE INTO run_changes (run, change) VALUES (?, ?)`, run, change);
}

/** A Run by its id, if there is one. */
export function runById(sql: SqlStorage, id: string): RunRow | null {
  return sql.exec<RunRow>(`SELECT * FROM runs WHERE id = ?`, id).toArray()[0] ?? null;
}

/**
 * The newest Run answering a Message from the person, the one the Conversation stands at for
 * them, if any. A Brief or a Review answers none.
 */
export function newestRun(sql: SqlStorage): RunRow | null {
  return (
    sql
      .exec<RunRow>(
        `SELECT * FROM runs WHERE message IS NOT NULL AND started_by = 'message'
         ORDER BY seq DESC LIMIT 1`,
      )
      .toArray()[0] ?? null
  );
}

/**
 * The Run answering each of these Messages, by the Message's id: the newest, when a failed one
 * was tried again.
 */
export function runsAnswering(sql: SqlStorage, messages: string[]): Map<string, RunRow> {
  if (messages.length === 0) return new Map();
  const rows = sql
    .exec<RunRow>(
      `SELECT * FROM runs WHERE message IN (${messages.map(() => "?").join(", ")}) ORDER BY seq`,
      ...messages,
    )
    .toArray();
  return new Map(rows.map((row) => [row.message ?? "", row]));
}

/**
 * What this Context has spent in the calendar month `at` falls in, in all, in US dollars: its Runs
 * started in it and its embedding for the meaning index. It is what it reports to the Deployment
 * object, which counts it against the cap (section 5.7).
 */
export function spentInMonth(sql: SqlStorage, at: number): number {
  const { start, end } = monthBounds(at);
  const runs = sql
    .exec<{ cost: number }>(
      `SELECT coalesce(sum(cost), 0) AS cost FROM runs WHERE at >= ? AND at < ?`,
      start,
      end,
    )
    .one().cost;
  return runs + embeddedInMonth(sql, at);
}
