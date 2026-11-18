import { monthBounds, type RunEnd, type RunStart } from "@praxis/domain";

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
};

/** What a Run spent: its tokens, and their cost by the price table shipped with the code. */
export type RunSpend = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

/** Keep the record of a Run as it starts, before the runtime runs anything. */
export function startRun(
  sql: SqlStorage,
  run: { startedBy: RunStart; message: string; submission: number; at: number; model: string },
): RunRow {
  return sql
    .exec<RunRow>(
      `INSERT INTO runs (id, started_by, message, submission, at, model) VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
      crypto.randomUUID(),
      run.startedBy,
      run.message,
      run.submission,
      run.at,
      run.model,
    )
    .one();
}

/**
 * Keep the record of a Run not started because the month's spend had reached the cap (section
 * 5.8): no Message was kept for it to answer, and it spent nothing. `list_runs` (#69) lists it.
 */
export function recordRunNotStarted(sql: SqlStorage, run: { at: number; model: string }): void {
  sql.exec(
    `INSERT INTO runs (id, started_by, at, model, ended) VALUES (?, 'message', ?, ?, 'cap_reached')`,
    crypto.randomUUID(),
    run.at,
    run.model,
  );
}

/** Say how a Run ended, and what it spent. */
export function endRun(sql: SqlStorage, id: string, ended: RunEnd, spend: RunSpend): void {
  sql.exec(
    `UPDATE runs SET ended = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?,
       cache_write_tokens = ?, cost = ?
     WHERE id = ? AND ended IS NULL`,
    ended,
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

/** The Runs answering these Messages, by the Message's id. */
export function runsAnswering(sql: SqlStorage, messages: string[]): Map<string, RunRow> {
  if (messages.length === 0) return new Map();
  const rows = sql
    .exec<RunRow>(
      `SELECT * FROM runs WHERE message IN (${messages.map(() => "?").join(", ")})`,
      ...messages,
    )
    .toArray();
  return new Map(rows.map((row) => [row.message ?? "", row]));
}

/**
 * What this Context's Runs started in the calendar month `at` falls in have spent, in all, in US
 * dollars: what it reports to the Deployment object, which counts it against the cap.
 */
export function spentInMonth(sql: SqlStorage, at: number): number {
  const { start, end } = monthBounds(at);
  return sql
    .exec<{ cost: number }>(
      `SELECT coalesce(sum(cost), 0) AS cost FROM runs WHERE at >= ? AND at < ?`,
      start,
      end,
    )
    .one().cost;
}
