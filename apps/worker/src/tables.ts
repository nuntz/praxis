/**
 * The Context object's own tables. The upgrade ladder of section 11 replaces this with
 * numbered steps before the first release.
 */
export function createTables(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      words TEXT NOT NULL,
      at INTEGER NOT NULL,
      author_kind TEXT NOT NULL,
      author_name TEXT,
      through_conversation INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_by_time ON entries (at, seq);

    -- A Task hangs off its Origin Entry. Its state is not a column: it is derived from its events.
    CREATE TABLE IF NOT EXISTS tasks (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      origin_entry TEXT NOT NULL REFERENCES entries (id),
      at INTEGER NOT NULL,
      author_kind TEXT NOT NULL,
      author_name TEXT,
      -- Days as YYYY-MM-DD, with no time of day, so no time zone moves them.
      due_date TEXT,
      defer_date TEXT
    );
    CREATE INDEX IF NOT EXISTS tasks_by_entry ON tasks (origin_entry, seq);

    -- What has happened to each Task, in order: it reached an end or was reopened.
    CREATE TABLE IF NOT EXISTS task_events (
      seq INTEGER PRIMARY KEY,
      task TEXT NOT NULL REFERENCES tasks (id),
      what TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS task_events_by_task ON task_events (task, seq);

    -- The Context's own settings, in one row with the Context's id. Not a record, but a change to
    -- them is an Effect on the Context.
    CREATE TABLE IF NOT EXISTS context_settings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      time_zone TEXT NOT NULL
    );

    -- The change log (section 4.4): one row per write that changed something, and its Effects.
    -- AUTOINCREMENT so a number is never given twice, even once the oldest are pruned.
    CREATE TABLE IF NOT EXISTS change_calls (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      caller_kind TEXT NOT NULL,
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
  `);
}
