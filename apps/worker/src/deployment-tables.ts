/**
 * The Deployment object's own tables. It holds nothing from any Journal (ADR 0006): for now the
 * list of Contexts with their names and accents, and the keys of the writes made to it. The
 * upgrade ladder of section 11 replaces this with numbered steps before the first release.
 */
export function createDeploymentTables(sql: SqlStorage): void {
  sql.exec(`
    -- One row per Context, in the order they were made. A Context's id is its object's.
    CREATE TABLE IF NOT EXISTS contexts (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      accent TEXT NOT NULL,
      -- A retired Context is hidden and keeps everything.
      retired INTEGER NOT NULL
    );

    -- Each caller's keys for its writes and the first result, remembered 30 days (section 4.5),
    -- as a Context's object keeps them.
    CREATE TABLE IF NOT EXISTS write_keys (
      caller TEXT NOT NULL,
      key TEXT NOT NULL,
      tool TEXT NOT NULL,
      at INTEGER NOT NULL,
      result TEXT NOT NULL,
      PRIMARY KEY (caller, key)
    );
  `);
}
