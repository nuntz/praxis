import {
  CLOCK_KINDS,
  type ClockKind,
  clockTimes,
  instantToIso,
  latestDue,
  mendedByWaiting,
  nextDue,
  type RunEnd,
  type RunFailure,
  type Settings,
  type StandingNotice,
} from "@praxis/domain";

/**
 * When the clock starts a Brief and a Review in a Context, and how its tries at one that was due
 * are going (section 5.4). Times are the object's, which a test sets.
 */

type ScheduleRow = {
  kind: ClockKind;
  through: number;
  trying: number | null;
  tries: number;
  retry_at: number | null;
  failure: RunFailure | null;
  failing_since: number | null;
  capped: number | null;
};

/** The first gap before a failed Brief or Review is tried again, doubling with each try. */
const FIRST_RETRY_GAP = 5 * 60 * 1000;
/** The longest gap between tries. */
const LONGEST_RETRY_GAP = 60 * 60 * 1000;
/**
 * How often one due at the cap looks again whether a Run may start, since raising the cap takes
 * effect at once and the Deployment object tells no Context it was raised.
 */
const CAP_RECHECK = 15 * 60 * 1000;

/**
 * Start the clock's schedule as at `at`, for a Context made then or one made before the clock
 * was: no Brief or Review that came before it is due.
 */
export function startSchedule(sql: SqlStorage, at: number): void {
  for (const kind of CLOCK_KINDS) {
    sql.exec(`INSERT OR IGNORE INTO clock_schedule (kind, through) VALUES (?, ?)`, kind, at);
  }
}

/**
 * A kind's time was set or switched off at `at`: none that came before is due, and tries at one
 * are dropped. Switched off, nothing of it is failing any more.
 */
export function restartSchedule(sql: SqlStorage, kind: ClockKind, at: number, on: boolean): void {
  startSchedule(sql, at);
  sql.exec(
    `UPDATE clock_schedule SET through = max(through, ?), trying = NULL, tries = 0, retry_at = NULL,
       capped = NULL
     WHERE kind = ?`,
    at,
    kind,
  );
  if (!on) {
    sql.exec(`UPDATE clock_schedule SET failure = NULL, failing_since = NULL WHERE kind = ?`, kind);
  }
}

/**
 * There is no Agent at `at`: nothing that came by then is ever due, even once a key is given
 * (section 5.4).
 */
export function noClockWithoutAgent(sql: SqlStorage, at: number): void {
  startSchedule(sql, at);
  sql.exec(`UPDATE clock_schedule SET through = max(through, ?)`, at);
}

function rows(sql: SqlStorage): ScheduleRow[] {
  return sql.exec<ScheduleRow>(`SELECT * FROM clock_schedule`).toArray();
}

/**
 * The Briefs and Reviews due at `at`, each by the time it came: the newest of its kind that has
 * not run, unless a failed try at it is waiting for its next. A newer one due drops the tries at
 * the one before.
 */
export function dueClockRuns(
  sql: SqlStorage,
  settings: Settings,
  at: number,
): { kind: ClockKind; due: number }[] {
  const due: { kind: ClockKind; due: number }[] = [];
  for (const row of rows(sql)) {
    const came = latestDue(clockTimes(row.kind, settings), settings.time_zone, at);
    if (came === null || came <= row.through) continue;
    if (row.trying === came && row.retry_at !== null && at < row.retry_at) continue;
    due.push({ kind: row.kind, due: came });
  }
  return due;
}

/** A Run is starting for the one that came at `due`. */
export function clockStarted(sql: SqlStorage, kind: ClockKind, due: number): void {
  sql.exec(
    `UPDATE clock_schedule
     SET tries = CASE WHEN trying = ? THEN tries ELSE 0 END, trying = ?, retry_at = NULL
     WHERE kind = ?`,
    due,
    due,
    kind,
  );
}

/**
 * The one that came at `due` cannot start at `at`, since the month's spend has reached the cap: it
 * waits, and looks again a little later. True the first time for that one, when its Run not
 * started is to be recorded.
 */
export function clockCapped(sql: SqlStorage, kind: ClockKind, due: number, at: number): boolean {
  const first =
    sql
      .exec<{ capped: number | null }>(`SELECT capped FROM clock_schedule WHERE kind = ?`, kind)
      .one().capped !== due;
  sql.exec(
    `UPDATE clock_schedule
     SET tries = CASE WHEN trying = ? THEN tries ELSE 0 END, trying = ?, retry_at = ?, capped = ?
     WHERE kind = ?`,
    due,
    due,
    at + CAP_RECHECK,
    due,
    kind,
  );
  return first;
}

/**
 * A Brief's or Review's Run started at `at` has ended. One that answered, or was cut short, is the
 * one that came; one that failed is tried again after a gap that grows with each try, and its
 * Notice stands until one of its kind runs. One no wait mends, a key or a request the provider
 * refused, is not tried again (section 5.4): that one is dropped, and the next is tried when it
 * comes.
 */
export function clockEnded(
  sql: SqlStorage,
  kind: ClockKind,
  ended: { how: RunEnd; failure: RunFailure | null; at: number },
): void {
  if (ended.how === "failed" && ended.failure !== null && !mendedByWaiting(ended.failure)) {
    sql.exec(
      `UPDATE clock_schedule
       SET through = max(through, coalesce(trying, through)), trying = NULL, tries = 0,
         retry_at = NULL, capped = NULL, failure = ?,
         failing_since = coalesce(failing_since, ?)
       WHERE kind = ?`,
      ended.failure,
      ended.at,
      kind,
    );
    return;
  }
  if (ended.how === "failed") {
    const { tries } = sql
      .exec<{ tries: number }>(`SELECT tries FROM clock_schedule WHERE kind = ?`, kind)
      .one();
    const gap = Math.min(FIRST_RETRY_GAP * 2 ** tries, LONGEST_RETRY_GAP);
    sql.exec(
      `UPDATE clock_schedule
       SET tries = tries + 1, retry_at = ?, failure = ?, failing_since = coalesce(failing_since, ?)
       WHERE kind = ?`,
      ended.at + gap,
      ended.failure ?? "model_unavailable",
      ended.at,
      kind,
    );
    return;
  }
  sql.exec(
    `UPDATE clock_schedule
     SET through = max(through, coalesce(trying, through)), trying = NULL, tries = 0,
       retry_at = NULL, failure = NULL, failing_since = NULL, capped = NULL
     WHERE kind = ?`,
    kind,
  );
}

/**
 * When the alarm should next wake for the clock, as at `at`: a try waiting for its gap, or the next
 * time one comes. One due now is started by the wake that finds it, so it is not armed for here.
 */
export function nextClockWake(sql: SqlStorage, settings: Settings, at: number): number | null {
  const wanted: number[] = [];
  for (const row of rows(sql)) {
    const times = clockTimes(row.kind, settings);
    if (row.retry_at !== null && row.retry_at > at) wanted.push(row.retry_at);
    const next = nextDue(times, settings.time_zone, Math.max(at, row.through));
    if (next !== null) wanted.push(next);
  }
  return wanted.length === 0 ? null : Math.min(...wanted);
}

/** A Brief or Review that could not run, as a standing Notice, one line for each kind. */
export function clockNotices(sql: SqlStorage): StandingNotice[] {
  return rows(sql).flatMap((row) =>
    row.failure === null || row.failing_since === null
      ? []
      : [
          {
            kind: "clock_failed" as const,
            clock: row.kind,
            failure: row.failure,
            since: instantToIso(row.failing_since),
          },
        ],
  );
}

/**
 * A Brief or Review has ended: whether it ran, whether it left a Message, and the ids of the Tasks
 * it names. One that ran replaces each of its kind not yet read (section 5.4), even with nothing to
 * raise, since what that one said is no longer so; one that failed read nothing, and replaces none.
 * Returns the ids of those it replaced, each a Message no longer shown.
 */
export function settleClockRun(
  sql: SqlStorage,
  run: { id: string; kind: ClockKind },
  answer: { ran: boolean; raised: boolean; tasksNamed: string[] },
): string[] {
  sql.exec(
    `UPDATE runs SET raised = ?, tasks_named = ? WHERE id = ?`,
    answer.raised ? 1 : 0,
    JSON.stringify(answer.tasksNamed),
    run.id,
  );
  if (!answer.ran) return [];
  return sql
    .exec<{ id: string }>(
      `UPDATE runs SET replaced = 1
       WHERE started_by = ? AND raised = 1 AND read_at IS NULL AND replaced = 0
         AND seq < (SELECT seq FROM runs WHERE id = ?)
       RETURNING id`,
      run.kind,
      run.id,
    )
    .toArray()
    .map(({ id }) => id);
}

/** How many of these Tasks have been Finished since `at`, and are so still. */
export function finishedSince(sql: SqlStorage, tasks: string[], at: number): number {
  if (tasks.length === 0) return 0;
  const ends = sql
    .exec<{ task: string; what: string; at: number }>(
      `SELECT task, what, at FROM task_events
       WHERE task IN (${tasks.map(() => "?").join(", ")})
         AND what IN ('finished', 'dropped', 'reopened')
       ORDER BY seq`,
      ...tasks,
    )
    .toArray();
  const last = new Map<string, { what: string; at: number }>();
  for (const end of ends) last.set(end.task, end);
  return [...last.values()].filter((end) => end.what === "finished" && end.at > at).length;
}

/**
 * Note that Praxis has shown a Brief or a Review, by its Run's id, at `at`: it is read from the
 * first time on. False when there is no such Brief or Review shown in the Conversation.
 */
export function noteShown(sql: SqlStorage, id: string, at: number): boolean {
  const shown = sql
    .exec(
      `UPDATE runs SET read_at = coalesce(read_at, ?)
       WHERE id = ? AND started_by != 'message' AND raised = 1 AND replaced = 0
       RETURNING id`,
      at,
      id,
    )
    .toArray();
  return shown.length > 0;
}
