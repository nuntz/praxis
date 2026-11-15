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
  `);
}
