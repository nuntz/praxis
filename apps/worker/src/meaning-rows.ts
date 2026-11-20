import { monthOf } from "@praxis/domain";

/**
 * What the Context's object keeps of its part of the meaning index (section 9.4): the queue SQLite
 * fills as Entries are made, changed and removed for good, whether the index is built, and what
 * embedding cost. The tables are made in `createMeaningQueue` (tables.ts).
 */

/** An Entry queued for the meaning index, as read before the object goes outside to act on it. */
export type Queued =
  | { what: "embed"; entry: string; queued: number; words: string }
  | { what: "remove"; entry: string; queued: number };

/**
 * The Entries queued longest, at most `count`, those to be taken out before those to be embedded,
 * so the cap, which stops embedding, never holds up a removal. Each to be embedded has its words.
 */
export function queued(sql: SqlStorage, count: number): Queued[] {
  return sql
    .exec<{ what: "embed" | "remove"; entry: string; queued: number; words: string | null }>(
      `SELECT q.what, q.entry, q.queued, e.words FROM meaning_queue q
       LEFT JOIN entries e ON e.id = q.entry
       ORDER BY q.what = 'embed', q.queued LIMIT ?`,
      count,
    )
    .toArray()
    .map(({ what, entry, queued, words }) =>
      what === "embed" && words !== null
        ? { what, entry, queued, words }
        : { what: "remove", entry, queued },
    );
}

/** Whether anything is queued for the meaning index. */
export function anythingQueued(sql: SqlStorage): boolean {
  return sql.exec(`SELECT 1 FROM meaning_queue LIMIT 1`).toArray().length > 0;
}

/**
 * Take off the queue what has been put in the index or taken out of it, each only while it is
 * still queued at the number it was read at: one changed meanwhile was queued again, and stays.
 * Once the queue is empty, the index is built.
 */
export function takeOffQueue(sql: SqlStorage, finished: { entry: string; queued: number }[]): void {
  for (const { entry, queued } of finished) {
    sql.exec(`DELETE FROM meaning_queue WHERE entry = ? AND queued = ?`, entry, queued);
  }
  if (!anythingQueued(sql)) sql.exec(`UPDATE meaning_index SET built = 1`);
}

/** Whether the meaning index is built from the whole Journal with the model in the code. */
export function meaningBuilt(sql: SqlStorage): boolean {
  return sql.exec<{ built: number }>(`SELECT built FROM meaning_index`).one().built === 1;
}

/** How many Entries are queued to be embedded. */
export function entriesToEmbed(sql: SqlStorage): number {
  return sql
    .exec<{ count: number }>(`SELECT count(*) AS count FROM meaning_queue WHERE what = 'embed'`)
    .one().count;
}

/** Count what an embedding cost in the calendar month `at` falls in. */
export function recordEmbedding(sql: SqlStorage, at: number, dollars: number): void {
  sql.exec(
    `INSERT INTO meaning_spend (month, dollars) VALUES (?, ?)
     ON CONFLICT (month) DO UPDATE SET dollars = dollars + excluded.dollars`,
    monthOf(at),
    dollars,
  );
}

/** What embedding has cost in the calendar month `at` falls in, in US dollars. */
export function embeddedInMonth(sql: SqlStorage, at: number): number {
  return (
    sql
      .exec<{ dollars: number }>(`SELECT dollars FROM meaning_spend WHERE month = ?`, monthOf(at))
      .toArray()[0]?.dollars ?? 0
  );
}
