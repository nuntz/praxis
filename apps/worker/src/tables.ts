import { MEANING_MODEL } from "./meaning.ts";

// The Context object's own tables are made and upgraded by its ladder of steps (src/steps/, section
// 11). What is here is what the object keeps beside them as it wakes, and reads of them a step
// must never change.

/** The table holding the words index, and the start of the name of each table SQLite keeps it in. */
export const WORDS_INDEX = "words_index";

/**
 * Keep the meaning index to the embedding model the code is shipped with, as the object wakes
 * (section 9.4): an object made before the meaning index, whose step gives it no model, or one
 * built under another model has its whole Journal queued, and search answers from words until it
 * is built. Not a step, since it reads the code's model, and changes only what is derived.
 */
export function keepMeaningModel(sql: SqlStorage): void {
  const { model } = sql.exec<{ model: string }>(`SELECT model FROM meaning_index`).one();
  if (model === MEANING_MODEL) return;
  sql.exec(`UPDATE meaning_index SET model = ?`, MEANING_MODEL);
  queueWholeJournal(sql);
}

/**
 * What no step of a Context's ladder may change (section 11), as one string to compare before a
 * step and after: the change log, every Version, and every Entry's words. A step changes shape,
 * never meaning, so a step that changes any of it fails. Read by the columns that hold it, so a
 * step may still add a column beside them; a release that moves them reads them where they are.
 */
export function untouchedByAnyStep(sql: SqlStorage): string {
  const tables = new Set(
    sql
      .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .toArray()
      .map(({ name }) => name),
  );
  const read: [string, string][] = [
    [
      "change_calls",
      `SELECT seq, at, caller_kind, caller_id, caller_name, tool FROM change_calls ORDER BY seq`,
    ],
    [
      "changes",
      `SELECT call, ord, kind, record_id, what, summary, by FROM changes ORDER BY call, ord`,
    ],
    [
      "entry_versions",
      `SELECT entry, version, words, at, author_kind, author_name FROM entry_versions ORDER BY seq`,
    ],
    ["entries", `SELECT id, words FROM entries ORDER BY seq`],
  ];
  let hash = FNV_OFFSET;
  for (const [table, query] of read) {
    // A table not made yet holds nothing, as one made empty does.
    if (!tables.has(table)) continue;
    for (const row of sql.exec(query))
      hash = fnv(hash, `${table}${JSON.stringify(Object.values(row))}`);
  }
  return hash.toString(16);
}

const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a over the UTF-16 code units of `text`, from `hash`. */
function fnv(hash: number, text: string): number {
  let next = hash;
  for (let place = 0; place < text.length; place += 1) {
    next = Math.imul(next ^ text.charCodeAt(place), 0x01000193) >>> 0;
  }
  return next;
}

/**
 * Queue every Entry to be embedded afresh, in the Trash or not, and mark the meaning index stale
 * until they are: on waking under a new embedding model and on `rebuild_search_index`. A Journal
 * with no Entry has nothing to build. Returns how many Entries it queued.
 */
export function queueWholeJournal(sql: SqlStorage): number {
  return queueToEmbed(sql, null);
}

/**
 * Queue these Entries to be embedded again, those still in the Journal, and mark the meaning index
 * stale until they are: they were taken out of it when deleting the Context stopped part-way.
 */
export function queueToEmbedAgain(sql: SqlStorage, entries: string[]): number {
  return queueToEmbed(sql, entries);
}

/** Queue these Entries to be embedded, or every Entry for null. Returns how many it queued. */
function queueToEmbed(sql: SqlStorage, only: string[] | null): number {
  const among = only === null ? "" : `WHERE id IN (SELECT value FROM json_each(?))`;
  const given = only === null ? [] : [JSON.stringify(only)];
  const { count } = sql
    .exec<{ count: number }>(`SELECT count(*) AS count FROM entries ${among}`, ...given)
    .one();
  sql.exec(
    `INSERT OR REPLACE INTO meaning_queue (entry, what, queued)
      SELECT id, 'embed', (SELECT queued FROM meaning_index) + row_number() OVER (ORDER BY seq)
      FROM entries ${among}`,
    ...given,
  );
  if (count > 0) sql.exec(`UPDATE meaning_index SET queued = queued + ?, built = 0`, count);
  else if (only === null) sql.exec(`UPDATE meaning_index SET built = 1`);
  return count;
}
