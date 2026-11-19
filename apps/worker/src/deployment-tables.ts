/**
 * The Deployment object's own tables. It holds nothing from any Journal (ADR 0006): for now the
 * list of Contexts with their names and accents, the Connections, the spend cap and what each
 * Context spent each month, whether the model's provider refuses the key, and the keys of the
 * writes made to it. The upgrade ladder of section 11 replaces this with numbered steps before
 * the first release.
 *
 * A Deployment is live: a column added to a table here reaches no Deployment object already
 * made, since its table exists. Add it where it is missing, as ADDED_COLUMNS in tables.ts does,
 * until the upgrade ladder (#76) replaces this.
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

    -- One row per Connection, in the order they were made (section 7.2). Its id is opaque and is
    -- the one in its address. An ended one is kept, so its id is never reached again.
    CREATE TABLE IF NOT EXISTS connections (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      context_id TEXT NOT NULL REFERENCES contexts (id),
      reading_only INTEGER NOT NULL,
      ended INTEGER NOT NULL
    );

    -- The monthly spend cap in US dollars (section 5.7): one row, once the person has set it.
    CREATE TABLE IF NOT EXISTS spend_cap (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      dollars REAL NOT NULL
    );

    -- What each Context spent in each calendar month (UTC), in US dollars, as it last reported.
    -- Not tied to the list of Contexts, so a deleted Context's spend can stay with no name.
    CREATE TABLE IF NOT EXISTS spend (
      month TEXT NOT NULL,
      context_id TEXT NOT NULL,
      dollars REAL NOT NULL,
      PRIMARY KEY (month, context_id)
    );

    -- The model's provider refusing the key (section 5.6): one row, from the first Run it refused
    -- until a call succeeds. A standing Notice in every Context while it is there.
    CREATE TABLE IF NOT EXISTS key_refused (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      since INTEGER NOT NULL
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
