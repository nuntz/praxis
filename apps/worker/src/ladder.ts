import type { Step } from "./steps/index.ts";

/**
 * Why an object serves nothing (section 11, ADR 0019): a step of its ladder failed under this
 * release, so it stays whole on the step before, or its tables stand on a step newer than the
 * code knows. `step` is the step that failed, or the one its tables stand on.
 */
export type StuckUpgrade = { release: string; step: number; cause: "failed" | "newer" };

/** Where an object stands once it has climbed its ladder as it woke. */
export type Climbed = {
  stuck: StuckUpgrade | null;
  /** Whether it was stuck when it woke and is no longer, so it says so and its clock starts again. */
  cameBack: boolean;
};

/** The release when the deploy names none: in tests and on this machine. */
const UNNAMED_RELEASE = "unreleased";

/** The release this Worker runs, which the deploy names after its commit (`RELEASE`). */
export function releaseOf(env: Env): string {
  return env.RELEASE || UNNAMED_RELEASE;
}

/**
 * Where each object stands on its ladder: the last step it finished; while it is stuck, the release
 * it is stuck under, the step that failed or that its tables stand on, and why; and the platform's
 * point-in-time bookmark noted before the first pending step of its last climb, with the step it
 * stood on then, for an operator to return the object to (docs/deployment.md). It is outside the
 * ladder, made here as it is, so its shape never changes.
 */
const LADDER = `
  CREATE TABLE IF NOT EXISTS ladder (
    one INTEGER PRIMARY KEY CHECK (one = 1),
    step INTEGER NOT NULL,
    stuck_under TEXT,
    stuck_step INTEGER,
    stuck_cause TEXT,
    bookmark TEXT,
    bookmark_step INTEGER
  )`;

type LadderRow = {
  step: number;
  stuck_under: string | null;
  stuck_step: number | null;
  stuck_cause: StuckUpgrade["cause"] | null;
};

/** How an object climbs: its ladder, the release it wakes under, and what no step may change. */
export type Climb = {
  /** Which ladder it is, for the log: a Context's object's, or the Deployment object's. */
  object: "context" | "deployment";
  ladder: readonly Step[];
  release: string;
  /**
   * What no step may change, read before each step and after, inside its transaction: a step that
   * changes it fails. A Context's object gives its change log, Versions and Entries' words.
   */
  untouched?: (sql: SqlStorage) => string;
};

/**
 * Upgrade an object's tables as it wakes, before it serves anything (section 11): each pending
 * step of its ladder in order, each in its own transaction, once the platform's point-in-time
 * bookmark is noted. A step that throws leaves the object whole on the step before, stuck under
 * this release, and it tries again only when woken under another. An object whose tables are
 * newer than the code is stuck too, and climbs nothing.
 */
export async function climb(storage: DurableObjectStorage, how: Climb): Promise<Climbed> {
  const { object, ladder, release, untouched } = how;
  const sql = storage.sql;
  sql.exec(LADDER);
  sql.exec(`INSERT OR IGNORE INTO ladder (one, step) VALUES (1, 0)`);
  const row = sql
    .exec<LadderRow>(`SELECT step, stuck_under, stuck_step, stuck_cause FROM ladder`)
    .one();
  const wasStuck = row.stuck_under !== null;
  if (row.step > ladder.length) {
    return {
      stuck: stick(sql, { release, step: row.step, cause: "newer" }, object),
      cameBack: false,
    };
  }
  if (row.stuck_under === release && row.stuck_step !== null && row.stuck_cause !== null) {
    return {
      stuck: { release: row.stuck_under, step: row.stuck_step, cause: row.stuck_cause },
      cameBack: false,
    };
  }
  if (row.step < ladder.length) {
    // A new object holds nothing to go back to, and is made, not upgraded.
    if (holdsTables(sql)) {
      const bookmark = await noteBookmark(storage, row.step, object);
      console.log(
        JSON.stringify({
          upgrade: "climbing",
          object,
          from: row.step,
          to: ladder.length,
          bookmark,
        }),
      );
    }
    for (let step = row.step + 1; step <= ladder.length; step += 1) {
      try {
        storage.transactionSync(() => {
          const before = untouched?.(sql);
          ladder[step - 1]?.(sql);
          if (untouched !== undefined && untouched(sql) !== before) {
            throw new Error(`Step ${step} changed what no step may change`);
          }
          sql.exec(`UPDATE ladder SET step = ?`, step);
        });
      } catch (error) {
        const why = error instanceof Error ? error.message : "unknown";
        console.error(JSON.stringify({ upgrade: "failed", object, step, release, error: why }));
        return { stuck: stick(sql, { release, step, cause: "failed" }, object), cameBack: false };
      }
    }
  }
  if (wasStuck) {
    sql.exec(`UPDATE ladder SET stuck_under = NULL, stuck_step = NULL, stuck_cause = NULL`);
    console.log(JSON.stringify({ upgrade: "came_back", object, release }));
  }
  return { stuck: null, cameBack: wasStuck };
}

/** Whether the object holds a table of its own beside its place on the ladder. */
function holdsTables(sql: SqlStorage): boolean {
  return (
    sql
      .exec(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name != 'ladder'
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' LIMIT 1`,
      )
      .toArray().length > 0
  );
}

/** Note that the object is stuck, and why. */
function stick(sql: SqlStorage, stuck: StuckUpgrade, object: Climb["object"]): StuckUpgrade {
  sql.exec(
    `UPDATE ladder SET stuck_under = ?, stuck_step = ?, stuck_cause = ?`,
    stuck.release,
    stuck.step,
    stuck.cause,
  );
  if (stuck.cause === "newer") {
    console.error(JSON.stringify({ upgrade: "newer", object, ...stuck }));
  }
  return stuck;
}

/**
 * Note the platform's point-in-time bookmark, as the object stands before its first pending step.
 * A bookmark the platform does not give is logged, and the climb goes on: one missing costs only
 * the operator's escape hatch, where a stuck object would cost the Context until the next release.
 */
async function noteBookmark(
  storage: DurableObjectStorage,
  step: number,
  object: Climb["object"],
): Promise<string | null> {
  try {
    const bookmark = await storage.getCurrentBookmark();
    storage.sql.exec(`UPDATE ladder SET bookmark = ?, bookmark_step = ?`, bookmark, step);
    return bookmark;
  } catch (error) {
    const why = error instanceof Error ? error.name : "unknown";
    console.error(JSON.stringify({ upgrade: "no_bookmark", object, error: why }));
    return null;
  }
}

/** What a stuck object answers, for its refusals and the Worker's page. */
export function stuckWords(stuck: StuckUpgrade): string {
  return stuck.cause === "failed"
    ? `step ${stuck.step} of its upgrade failed under release ${stuck.release}`
    : `its tables stand on step ${stuck.step} of its upgrade, newer than release ${stuck.release} knows`;
}

/** What starts the message of the error a stuck Deployment object throws, which the Worker reads. */
const STUCK_MARK = "praxis: the Deployment object is stuck on its upgrade: ";

/**
 * The error every call to the Deployment object throws while it is stuck on its upgrade: nothing
 * can be routed (section 11). Its message carries why, since an error crossing to another object
 * keeps only its message.
 */
export function deploymentStuck(stuck: StuckUpgrade): Error {
  return new Error(`${STUCK_MARK}${JSON.stringify(stuck)}`);
}

/** Why the Deployment object is stuck, when this is the error it threw for it. */
export function stuckIn(error: unknown): StuckUpgrade | null {
  if (!(error instanceof Error)) return null;
  const at = error.message.indexOf(STUCK_MARK);
  if (at === -1) return null;
  try {
    return JSON.parse(error.message.slice(at + STUCK_MARK.length)) as StuckUpgrade;
  } catch {
    return null;
  }
}
