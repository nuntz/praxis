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
      deployment TEXT
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
      -- What started it: for now only a Message from the person, sent or tried again.
      started_by TEXT NOT NULL,
      -- The id of the person's Message it answers, never its words.
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
      from_record INTEGER
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
