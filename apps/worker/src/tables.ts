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
