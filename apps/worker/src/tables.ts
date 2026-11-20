import { MEANING_MODEL } from "./meaning.ts";

/**
 * The Context object's own tables. The upgrade ladder of section 11 replaces this with
 * numbered steps before the first release. Foreign keys are enforced: a delete first clears every
 * row that references the one it removes.
 *
 * A Deployment is live: a column added to a table here reaches no object already made, since its
 * table exists. Add it to ADDED_COLUMNS too, until the upgrade ladder (#76) replaces this.
 */
export function createTables(sql: SqlStorage): void {
  createTablesAsMade(sql);
  addMissingColumns(sql);
  createWordsIndex(sql);
  createMeaningQueue(sql);
}

/** Every table as a new object makes it. */
function createTablesAsMade(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      words TEXT NOT NULL,
      at INTEGER NOT NULL,
      author_kind TEXT NOT NULL,
      author_name TEXT,
      through_conversation INTEGER NOT NULL,
      -- The one earlier Entry it is a Follow-up to, if any.
      follow_up_to TEXT REFERENCES entries (id)
    );
    CREATE INDEX IF NOT EXISTS entries_by_time ON entries (at, seq);
    CREATE INDEX IF NOT EXISTS entries_by_follow_up_to ON entries (follow_up_to);

    -- Every earlier state of an Entry's words, part of the Entry: the words it had at a version,
    -- and who changed them and when. Never pruned and never coalesced. An Entry's version is how
    -- many it has.
    CREATE TABLE IF NOT EXISTS entry_versions (
      seq INTEGER PRIMARY KEY,
      entry TEXT NOT NULL REFERENCES entries (id),
      version INTEGER NOT NULL,
      words TEXT NOT NULL,
      at INTEGER NOT NULL,
      author_kind TEXT NOT NULL,
      author_name TEXT,
      UNIQUE (entry, version)
    );

    -- The Standing marks (section 5.5), kept beside the Entries they mark and part of each: the
    -- Agent is given every Entry marked here and not in the Trash at the start of every Run.
    CREATE TABLE IF NOT EXISTS standing_marks (
      entry TEXT PRIMARY KEY REFERENCES entries (id)
    );

    -- The Held Changes waiting for the person's tap (section 4.7): a call from the Agent to change
    -- or delete the words of an Entry the person wrote. None is a record. Each holds what the tap
    -- does, and what it was left against: the Entry's version and, for a delete, the Tasks that
    -- would go with it. Once either moves on it lapses, so one is never left on an Entry in the
    -- Trash.
    CREATE TABLE IF NOT EXISTS held_changes (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      entry TEXT NOT NULL REFERENCES entries (id),
      tool TEXT NOT NULL,
      -- The words the tap gives the Entry, or null for a delete.
      words TEXT,
      -- The Tasks the tap makes with them, as JSON: the titles of the Inline Tasks an edit added.
      new_tasks TEXT NOT NULL,
      version INTEGER NOT NULL,
      -- The ids of the Tasks a delete would take, as JSON, in the order made.
      goes_with TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS held_changes_by_entry ON held_changes (entry);

    -- A Project contains Tasks. Its state is not a column: it is derived from what was declared.
    CREATE TABLE IF NOT EXISTS projects (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      at INTEGER NOT NULL,
      due_date TEXT
    );

    -- What was declared of each Project, in order: it reached an end or was reopened.
    CREATE TABLE IF NOT EXISTS project_events (
      seq INTEGER PRIMARY KEY,
      project TEXT NOT NULL REFERENCES projects (id),
      what TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_events_by_project ON project_events (project, seq);

    -- A Person has a name and nothing else. Two may share one.
    CREATE TABLE IF NOT EXISTS persons (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      at INTEGER NOT NULL
    );

    -- A Task hangs off its Origin Entry. Its state is not a column: it is derived from its events.
    CREATE TABLE IF NOT EXISTS tasks (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      origin_entry TEXT NOT NULL REFERENCES entries (id),
      at INTEGER NOT NULL,
      author_kind TEXT NOT NULL,
      author_name TEXT,
      -- The Project it is in, if any. Membership is the Task's, so a Task joining or leaving one
      -- changes the Task alone.
      project TEXT REFERENCES projects (id),
      -- Days as YYYY-MM-DD, with no time of day, so no time zone moves them.
      due_date TEXT,
      defer_date TEXT,
      -- Its Recurrence as JSON, held by the open Occurrence only: closing it moves the rule on.
      recurrence TEXT
    );
    CREATE INDEX IF NOT EXISTS tasks_by_entry ON tasks (origin_entry, seq);
    CREATE INDEX IF NOT EXISTS tasks_by_project ON tasks (project, seq);

    -- What has happened to each Task, in order: it reached an end or was reopened, it was
    -- Delegated to a Person or taken back, or it started waiting on a Task or Project and stopped
    -- or was released. Delegated holds until the next end or taking back, and a wait until it
    -- stops, is released or the Task reaches an end.
    CREATE TABLE IF NOT EXISTS task_events (
      seq INTEGER PRIMARY KEY,
      task TEXT NOT NULL REFERENCES tasks (id),
      what TEXT NOT NULL,
      at INTEGER NOT NULL,
      -- The Person it was Delegated to, for a delegation only.
      person TEXT REFERENCES persons (id),
      -- The Task or Project waited on, for a wait, its stopping or its release only.
      on_kind TEXT,
      on_id TEXT
    );
    CREATE INDEX IF NOT EXISTS task_events_by_task ON task_events (task, seq);
    CREATE INDEX IF NOT EXISTS task_events_by_waited_on ON task_events (on_id);

    -- An Entry's References and Mentions, kept beside its words and part of the Entry (ADR 0008).
    -- An anchor keeps the text it spanned, so a span that is gone from the words reads as none.
    CREATE TABLE IF NOT EXISTS entry_links (
      seq INTEGER PRIMARY KEY,
      entry TEXT NOT NULL REFERENCES entries (id),
      to_kind TEXT NOT NULL,
      to_id TEXT NOT NULL,
      anchor_start INTEGER,
      anchor_end INTEGER,
      anchor_text TEXT
    );
    CREATE INDEX IF NOT EXISTS entry_links_by_entry ON entry_links (entry, seq);
    CREATE INDEX IF NOT EXISTS entry_links_by_target ON entry_links (to_id);

    -- The Trash (section 3.8). An item is what one delete sent there: the record deleted, and when,
    -- from which its one clock runs. Its records stay in their own tables, out of every read.
    CREATE TABLE IF NOT EXISTS trash_items (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trash_items_by_time ON trash_items (at);

    -- Each record in the Trash and the item it went in: the one deleted, and what went with it.
    CREATE TABLE IF NOT EXISTS trashed (
      seq INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      item TEXT NOT NULL REFERENCES trash_items (id),
      UNIQUE (kind, record_id)
    );
    CREATE INDEX IF NOT EXISTS trashed_by_item ON trashed (item, seq);

    -- A link from a Task not in the Trash to a record a delete sent there, which the delete took
    -- away by rule and a restore can bring back: the Task's place in a Project, its delegation, or
    -- a wait. A Reference, Mention or Follow-up link stays where it is, dormant while what it names
    -- is in the Trash.
    CREATE TABLE IF NOT EXISTS dormant_links (
      seq INTEGER PRIMARY KEY,
      item TEXT NOT NULL REFERENCES trash_items (id),
      task TEXT NOT NULL REFERENCES tasks (id),
      what TEXT NOT NULL,
      to_kind TEXT NOT NULL,
      to_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS dormant_links_by_item ON dormant_links (item);

    -- The records not in the Trash, which every read and every change goes through: a record in
    -- the Trash is in no view or list, and cannot be changed or linked to.
    CREATE VIEW IF NOT EXISTS untrashed_entries AS
      SELECT * FROM entries
      WHERE id NOT IN (SELECT record_id FROM trashed WHERE kind = 'entry');
    -- The Standing Entries not in the Trash: the ones the Agent is given and every read lists.
    CREATE VIEW IF NOT EXISTS standing_entries AS
      SELECT * FROM untrashed_entries WHERE id IN (SELECT entry FROM standing_marks);
    CREATE VIEW IF NOT EXISTS untrashed_tasks AS
      SELECT * FROM tasks
      WHERE id NOT IN (SELECT record_id FROM trashed WHERE kind = 'task');
    CREATE VIEW IF NOT EXISTS untrashed_projects AS
      SELECT * FROM projects
      WHERE id NOT IN (SELECT record_id FROM trashed WHERE kind = 'project');
    CREATE VIEW IF NOT EXISTS untrashed_persons AS
      SELECT * FROM persons
      WHERE id NOT IN (SELECT record_id FROM trashed WHERE kind = 'person');

    -- The Context's own settings, in one row with the Context's id. Not a record, but a change to
    -- them is an Effect on the Context.
    CREATE TABLE IF NOT EXISTS context_settings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      -- The Deployment object that made it, which it asks for the other Contexts' names.
      deployment TEXT,
      -- When the Brief and the Review come, in its time zone: a time is null while it is off.
      brief_time TEXT DEFAULT '07:00',
      review_day TEXT NOT NULL DEFAULT 'sunday',
      review_time TEXT DEFAULT '17:00',
      -- Its one Notification switch, covering the Brief and the Review (section 8.7).
      notifications INTEGER NOT NULL DEFAULT 1
    );

    -- The change log (section 4.4): one row per write that changed something, and its Effects.
    -- AUTOINCREMENT so a number is never given twice, even once the oldest are pruned.
    CREATE TABLE IF NOT EXISTS change_calls (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      caller_kind TEXT NOT NULL,
      -- A Connection's id, and the name it had when it called, which is kept after it ends.
      caller_id TEXT,
      caller_name TEXT,
      tool TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS changes (
      call INTEGER NOT NULL REFERENCES change_calls (seq),
      ord INTEGER NOT NULL,
      kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      what TEXT NOT NULL,
      summary TEXT NOT NULL,
      by TEXT NOT NULL,
      PRIMARY KEY (call, ord)
    );
    -- How far the log has been pruned, at 90 days, so a cursor from before is told to read afresh.
    CREATE TABLE IF NOT EXISTS change_log_pruned (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      through INTEGER NOT NULL
    );

    -- Each caller's keys for its writes and the first result, remembered 30 days (section 4.5).
    CREATE TABLE IF NOT EXISTS write_keys (
      caller TEXT NOT NULL,
      key TEXT NOT NULL,
      tool TEXT NOT NULL,
      at INTEGER NOT NULL,
      result TEXT NOT NULL,
      PRIMARY KEY (caller, key)
    );
    CREATE INDEX IF NOT EXISTS write_keys_by_time ON write_keys (at);

    -- A Run record (section 5.8): what the Agent did, with no words. Kept for good. What was said
    -- is in the runtime's own tables, which hold only the Conversation.
    CREATE TABLE IF NOT EXISTS runs (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      -- What started it: a Message from the person, sent or tried again, or the clock, for a Brief
      -- or a Review.
      started_by TEXT NOT NULL,
      -- The id of the person's Message it answers, never its words; for the clock's, the id of the
      -- record that started it in the Conversation.
      message TEXT,
      -- The runtime's handle on the Message it answers, to learn how it ended after a restart.
      -- None for a Run never started, because the month's spend had reached the cap.
      submission INTEGER,
      at INTEGER NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      -- In US dollars, by the price table shipped with the code.
      cost REAL NOT NULL DEFAULT 0,
      -- How it ended, null while it is going.
      ended TEXT,
      -- Why it failed, for a Run that did: the model not reached, or the key refused.
      failure TEXT,
      -- For a Run trying a failed one again, the runtime's first record that may be its own: the
      -- records before it are the Runs' before it, and their spend counted with them.
      from_record INTEGER,
      -- For a Run answering a new Message, the number of the change the log stood at when the
      -- Agent was told what changed since the last Message it answered: the next is told from there.
      told_through INTEGER,
      -- For a Brief or a Review once it has ended: whether it left a Message (a Brief with nothing
      -- to raise leaves none), whether a newer one of its kind replaced it unread, when Praxis first
      -- showed it, and the ids of the Tasks it names, as JSON.
      raised INTEGER,
      replaced INTEGER NOT NULL DEFAULT 0,
      read_at INTEGER,
      tasks_named TEXT
    );
    -- When the clock last started a Brief and a Review, and how its tries at one that was due are
    -- going (section 5.4). One row each.
    CREATE TABLE IF NOT EXISTS clock_schedule (
      kind TEXT PRIMARY KEY,
      -- The newest time it came whose Run has been answered, or that came before the Context was
      -- made or its time was set: nothing at or before it is due.
      through INTEGER NOT NULL,
      -- The time it came that the Run going, or the last tried, is for.
      trying INTEGER,
      -- How many tries at it have failed, when the next may be made, and why the last failed.
      tries INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER,
      failure TEXT,
      -- Since when its tries have failed, for the Notice, until one of its kind runs.
      failing_since INTEGER,
      -- The time it came for which a Run not started at the cap has been recorded.
      capped INTEGER
    );
    -- Each unit on its way out of this Context to another (section 3.9): the move's id, the
    -- Context it goes to, when the person asked and as whom, and, as JSON, the record asked for
    -- and the unit's records as they go, in the shapes an Export holds them in. Its records are
    -- gone from every other table, so it is in no view; the row is removed once the other Context
    -- has said it took it.
    CREATE TABLE IF NOT EXISTS moves_out (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      to_context TEXT NOT NULL,
      at INTEGER NOT NULL,
      caller TEXT NOT NULL,
      move TEXT NOT NULL
    );
    -- Each move this Context has taken a unit under, with the Effects taking it had, as JSON, and
    -- when, so a move asked again adds nothing twice and answers as it did. Forgotten at 30 days.
    CREATE TABLE IF NOT EXISTS moves_in (
      id TEXT PRIMARY KEY,
      effects TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    -- The changes a Run made, as the change log numbers them. One may point at a line pruned since.
    CREATE TABLE IF NOT EXISTS run_changes (
      run TEXT NOT NULL REFERENCES runs (id),
      change INTEGER NOT NULL,
      PRIMARY KEY (run, change)
    );
  `);
}

/**
 * Columns added to a table after a live Deployment's objects were made with it: each is added
 * where it is missing, as the object wakes. The upgrade ladder (#76) replaces this.
 */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [
  { table: "runs", column: "failure", type: "TEXT" },
  { table: "runs", column: "from_record", type: "INTEGER" },
  { table: "runs", column: "told_through", type: "INTEGER" },
  { table: "runs", column: "raised", type: "INTEGER" },
  { table: "runs", column: "replaced", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "runs", column: "read_at", type: "INTEGER" },
  { table: "runs", column: "tasks_named", type: "TEXT" },
  { table: "context_settings", column: "brief_time", type: "TEXT DEFAULT '07:00'" },
  { table: "context_settings", column: "review_day", type: "TEXT NOT NULL DEFAULT 'sunday'" },
  { table: "context_settings", column: "review_time", type: "TEXT DEFAULT '17:00'" },
  { table: "context_settings", column: "notifications", type: "INTEGER NOT NULL DEFAULT 1" },
];

/** Add each column a table made before it was added still lacks. */
function addMissingColumns(sql: SqlStorage): void {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const has = sql
      .exec(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`, table, column)
      .toArray().length;
    if (has === 0) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Each kind of record the words index holds: its table, the column searched, and its slot, which
 * tells its rows apart from the other kinds' (see `createWordsIndex`).
 */
const INDEXED = [
  { kind: "entry", table: "entries", column: "words", slot: 0 },
  { kind: "task", table: "tasks", column: "title", slot: 1 },
  { kind: "project", table: "projects", column: "name", slot: 2 },
  { kind: "person", table: "persons", column: "name", slot: 3 },
] as const;

/** A record's row in the words index, as SQL: its `seq` times the kinds, plus its kind's slot. */
function indexRow(seq: string, slot: number): string {
  return `${seq} * ${INDEXED.length} + ${slot}`;
}

/** The table holding the words index, and the start of the name of each table SQLite keeps it in. */
export const WORDS_INDEX = "words_index";

/**
 * The words index (section 9.4): the words of each Entry and the title or name of each Task,
 * Project and Person not in the Trash, for `search`. It is derived, and kept by SQLite itself as
 * each record table and the Trash change, so no write can leave it behind: a record is in it from
 * the moment it is made, follows each change to its words, leaves it on going to the Trash or
 * being removed for good, and returns on restore. Case and accents are set aside, as `named` sets
 * them aside for a picker.
 *
 * Four kinds share one index, so each row's id is the record's `seq` times four plus its kind's
 * slot, which reaches the row without a scan.
 *
 * Removal for good takes a record out of the Trash before it deletes the record's row, so the
 * record is put back in the index and taken out again in the same transaction: the order of the
 * deletes leaves the index right either way.
 *
 * An object made before it gets it as it wakes, filled from the records not in the Trash.
 */
function createWordsIndex(sql: SqlStorage): void {
  const indexedBefore =
    sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, WORDS_INDEX).toArray()
      .length > 0;
  sql.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${WORDS_INDEX} USING fts5 (
      kind UNINDEXED, record_id UNINDEXED, text,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `);
  for (const { kind, table, column, slot } of INDEXED) {
    sql.exec(`
      CREATE TRIGGER IF NOT EXISTS ${WORDS_INDEX}_${kind}_made AFTER INSERT ON ${table} BEGIN
        INSERT INTO ${WORDS_INDEX} (rowid, kind, record_id, text)
          VALUES (${indexRow("NEW.seq", slot)}, '${kind}', NEW.id, NEW.${column});
      END;
      CREATE TRIGGER IF NOT EXISTS ${WORDS_INDEX}_${kind}_changed
      AFTER UPDATE OF ${column} ON ${table} BEGIN
        UPDATE ${WORDS_INDEX} SET text = NEW.${column} WHERE rowid = ${indexRow("NEW.seq", slot)};
      END;
      CREATE TRIGGER IF NOT EXISTS ${WORDS_INDEX}_${kind}_removed AFTER DELETE ON ${table} BEGIN
        DELETE FROM ${WORDS_INDEX} WHERE rowid = ${indexRow("OLD.seq", slot)};
      END;
    `);
  }
  // The index's row for the record a row of `trashed` names, as SQL selecting it.
  const trashedRecord = (row: "NEW" | "OLD") =>
    INDEXED.map(
      ({ kind, table, column, slot }) =>
        `SELECT ${indexRow("seq", slot)} AS index_row, '${kind}' AS kind, id, ${column} AS text
         FROM ${table} WHERE ${row}.kind = '${kind}' AND id = ${row}.record_id`,
    ).join(" UNION ALL ");
  sql.exec(`
    CREATE TRIGGER IF NOT EXISTS ${WORDS_INDEX}_trashed AFTER INSERT ON trashed BEGIN
      DELETE FROM ${WORDS_INDEX} WHERE rowid IN (SELECT index_row FROM (${trashedRecord("NEW")}));
    END;
    CREATE TRIGGER IF NOT EXISTS ${WORDS_INDEX}_restored AFTER DELETE ON trashed BEGIN
      INSERT INTO ${WORDS_INDEX} (rowid, kind, record_id, text) ${trashedRecord("OLD")};
    END;
  `);
  if (indexedBefore) return;
  for (const { kind, table, column, slot } of INDEXED) {
    sql.exec(`
      INSERT INTO ${WORDS_INDEX} (rowid, kind, record_id, text)
        SELECT ${indexRow("seq", slot)}, '${kind}', id, ${column} FROM untrashed_${table}
    `);
  }
}

/**
 * What the Context's object keeps of its part of the meaning index (section 9.4), which is outside
 * it, in Vectorize: the embedding model it is built with and whether it is built from the whole
 * Journal, the Entries whose embedding it has still to put or take away, and what embedding has
 * cost each month. None of it is a record, and all of it can be thrown away and rebuilt.
 *
 * The queue is kept by SQLite, as the words index is, so no write can leave the index behind: an
 * Entry made, or whose words change, is queued to be embedded, and one removed for good to be taken
 * out. An Entry sent to the Trash keeps its embedding, which search never returns while it is
 * there, so a restore brings it back to search by meaning at once. Each queued Entry carries the
 * number it was queued at, so the object takes it off the queue only while it is the one it read.
 *
 * An object made before it, or under another embedding model, has its whole Journal queued as it
 * wakes, and its index is stale until the queue is empty: search answers from words till then.
 */
function createMeaningQueue(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS meaning_index (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      model TEXT NOT NULL,
      -- 1 once every Entry queued when it was last marked stale has been embedded.
      built INTEGER NOT NULL,
      -- The number the next Entry queued is queued at.
      queued INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meaning_queue (
      entry TEXT PRIMARY KEY,
      what TEXT NOT NULL CHECK (what IN ('embed', 'remove')),
      -- The number it was queued at, which is new each time it is queued.
      queued INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meaning_queue_in_order ON meaning_queue (queued);
    -- What embedding cost in each calendar month (YYYY-MM, UTC), in US dollars, counted toward the
    -- cap with the Run records (section 5.7).
    CREATE TABLE IF NOT EXISTS meaning_spend (
      month TEXT PRIMARY KEY,
      dollars REAL NOT NULL
    );
  `);
  const queue = (entry: string, what: "embed" | "remove") => `
    UPDATE meaning_index SET queued = queued + 1;
    INSERT OR REPLACE INTO meaning_queue (entry, what, queued)
      VALUES (${entry}, '${what}', (SELECT queued FROM meaning_index));`;
  sql.exec(`
    CREATE TRIGGER IF NOT EXISTS meaning_entry_made AFTER INSERT ON entries BEGIN
      ${queue("NEW.id", "embed")}
    END;
    CREATE TRIGGER IF NOT EXISTS meaning_entry_changed AFTER UPDATE OF words ON entries BEGIN
      ${queue("NEW.id", "embed")}
    END;
    CREATE TRIGGER IF NOT EXISTS meaning_entry_removed AFTER DELETE ON entries BEGIN
      ${queue("OLD.id", "remove")}
    END;
  `);
  const kept = sql.exec<{ model: string }>(`SELECT model FROM meaning_index`).toArray()[0];
  if (kept === undefined) {
    sql.exec(
      `INSERT INTO meaning_index (one, model, built, queued) VALUES (1, ?, 0, 0)`,
      MEANING_MODEL,
    );
    queueWholeJournal(sql);
  } else if (kept.model !== MEANING_MODEL) {
    sql.exec(`UPDATE meaning_index SET model = ?`, MEANING_MODEL);
    queueWholeJournal(sql);
  }
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
