import {
  type Effect,
  type Entry,
  HELD_SUMMARY,
  type Held,
  type HeldChange,
  type HeldTool,
  instantToIso,
  type NewTask,
  type RecordNamed,
  summarizeWords,
} from "@praxis/domain";

/** A Held Change as its table holds it. */
export type HeldRow = {
  seq: number;
  id: string;
  entry: string;
  tool: HeldTool;
  words: string | null;
  new_tasks: string;
  version: number;
  goes_with: string;
  at: number;
};

/**
 * Leave a Held Change for the person's tap (section 4.7): what the Agent's call would do to an
 * Entry the person wrote, against the Entry as it is now. It changes nothing else, and its making
 * is its one Effect.
 */
export function leaveHeldChange(
  sql: SqlStorage,
  held: {
    tool: HeldTool;
    entry: Entry;
    words: string | null;
    newTasks: NewTask[];
    at: number;
  },
): Held {
  const id = crypto.randomUUID();
  const goesWith = held.tool === "delete_entry" ? held.entry.tasks.map((task) => task.id) : [];
  sql.exec(
    `INSERT INTO held_changes (id, entry, tool, words, new_tasks, version, goes_with, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    held.entry.id,
    held.tool,
    held.words,
    JSON.stringify(held.newTasks.map(({ title }) => ({ title }))),
    held.entry.version,
    JSON.stringify(goesWith),
    held.at,
  );
  const left = readHeldChange(sql, id) as HeldChange;
  return { record: left, effects: [heldEffect(left, "made", "call")], changed: true, held: true };
}

/** A Held Change waiting, by its id, as a read gives it, or null when none is. */
export function readHeldChange(sql: SqlStorage, id: string): HeldChange | null {
  const row = heldRow(sql, id);
  return row ? (heldChangesFrom(sql, [row])[0] ?? null) : null;
}

/** A Held Change waiting as its table holds it, by its id, or null when none is. */
export function heldRow(sql: SqlStorage, id: string): HeldRow | null {
  return sql.exec<HeldRow>(`SELECT * FROM held_changes WHERE id = ?`, id).toArray()[0] ?? null;
}

/**
 * The Held Changes their rows hold, each with its Entry as it is now: the words before, and the
 * Tasks a delete would take, named as they are now called.
 */
export function heldChangesFrom(sql: SqlStorage, rows: HeldRow[]): HeldChange[] {
  const words = new Map(
    sql
      .exec<{ id: string; words: string }>(
        `SELECT id, words FROM entries WHERE id IN (SELECT value FROM json_each(?))`,
        JSON.stringify(rows.map((row) => row.entry)),
      )
      .toArray()
      .map((row) => [row.id, row.words]),
  );
  const titles = new Map(
    sql
      .exec<{ id: string; title: string }>(
        `SELECT id, title FROM tasks WHERE id IN (
           SELECT t.value FROM held_changes h, json_each(h.goes_with) t
           WHERE h.id IN (SELECT value FROM json_each(?)))`,
        JSON.stringify(rows.map((row) => row.id)),
      )
      .toArray()
      .map((row) => [row.id, row.title]),
  );
  return rows.map((row) => {
    const before = words.get(row.entry) ?? "";
    return {
      id: row.id,
      tool: row.tool,
      summary: HELD_SUMMARY[row.tool],
      entry: { id: row.entry, summary: summarizeWords(before) },
      before,
      after: row.words,
      new_tasks: newTasksOf(row),
      goes_with: (JSON.parse(row.goes_with) as string[]).map(
        (id): RecordNamed => ({ kind: "task", id, summary: titles.get(id) ?? "" }),
      ),
      at: instantToIso(row.at),
    };
  });
}

/** The Tasks a Held Change's tap makes: the Inline Tasks an edit added. */
export function newTasksOf(row: HeldRow): NewTask[] {
  return JSON.parse(row.new_tasks) as NewTask[];
}

/** Take a Held Change away, made or cancelled by the call, or lapsed by rule. */
export function endHeldChange(sql: SqlStorage, held: HeldChange, by: Effect["by"]): Effect {
  sql.exec(`DELETE FROM held_changes WHERE id = ?`, held.id);
  return heldEffect(held, "deleted", by);
}

/**
 * Lapse each Held Change whose Entry has changed underneath it (section 4.7), so a tap never makes
 * a change other than the one shown: its words moved on, or it went to the Trash, or, for a
 * delete, the Tasks that would go with it are no longer those shown. Each is an Effect by rule of
 * the write that changed the Entry.
 */
export function lapseHeldChanges(sql: SqlStorage): Effect[] {
  const rows = sql.exec<HeldRow>(`SELECT * FROM held_changes ORDER BY seq`).toArray();
  if (rows.length === 0) return [];
  const lapsed = rows.filter((row) => {
    // The Entry's version is how many Versions it has, as readEntry numbers it.
    const entry = sql
      .exec<{ version: number }>(
        `SELECT (SELECT count(*) FROM entry_versions WHERE entry = e.id) AS version
         FROM untrashed_entries e WHERE e.id = ?`,
        row.entry,
      )
      .toArray()[0];
    if (!entry || entry.version !== row.version) return true;
    if (row.tool !== "delete_entry") return false;
    const going = sql
      .exec<{ id: string }>(
        `SELECT id FROM untrashed_tasks WHERE origin_entry = ? ORDER BY seq`,
        row.entry,
      )
      .toArray()
      .map((task) => task.id);
    return JSON.stringify(going) !== row.goes_with;
  });
  return heldChangesFrom(sql, lapsed).map((held) => endHeldChange(sql, held, "rule"));
}

/** The Effect on a Held Change, summarised by what the tap would do. */
function heldEffect(held: HeldChange, what: Effect["what"], by: Effect["by"]): Effect {
  return { kind: "held_change", id: held.id, what, summary: held.summary, by };
}
