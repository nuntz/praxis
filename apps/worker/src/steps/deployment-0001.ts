// Step 1 of the Deployment object's upgrade ladder (section 11, ADR 0019). Released: never
// edited, dropped or squashed. A fix is a new step. It imports nothing, so nothing outside it can
// change what it does (lint/steps.test.ts).
//
// The tables as the first release made them. The Deployment object holds nothing from any Journal
// (ADR 0006). One made before the ladder holds some of them already: a table it holds is kept,
// and a column added since is added.

export default function deploymentStep1(sql: SqlStorage): void {
  sql.exec(`
    -- One row per Context, in the order they were made. A Context's id is its object's.
    CREATE TABLE IF NOT EXISTS contexts (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      accent TEXT NOT NULL,
      -- A retired Context is hidden and keeps everything.
      retired INTEGER NOT NULL,
      -- When the last Backup holding its file was made, null while none has: the one Backup kept
      -- past its 30 days while the Context is stuck on an upgrade (section 11).
      backed_up INTEGER
    );

    -- One row per Connection, in the order they were made (section 7.2). Its id is opaque and is
    -- the one in its address. An ended one is kept, so its id is never reached again, until its
    -- Context is deleted, which deletes it.
    CREATE TABLE IF NOT EXISTS connections (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      context_id TEXT NOT NULL REFERENCES contexts (id),
      reading_only INTEGER NOT NULL,
      ended INTEGER NOT NULL
    );

    -- One row per Device while something is switched on there (section 8.10), in the order first
    -- switched on. Its id is the one its browser keeps. With Notifications on it holds the push
    -- subscription its browser gave, as JSON; once nothing is on, the row goes.
    CREATE TABLE IF NOT EXISTS devices (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      notifications INTEGER NOT NULL,
      subscription TEXT,
      -- When it last called a Deployment tool: a sighting, which no write reports as an Effect.
      seen INTEGER NOT NULL
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

    -- The daily Backup (section 10.3): one row, from the first Context made or the first Backup
    -- tried. When the three days without a Backup began to be counted, and when the last one was
    -- made, null while none has been, which settings shows. A standing Notice when none has been
    -- made for three days since the later of the two.
    CREATE TABLE IF NOT EXISTS backups (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      counted_from INTEGER NOT NULL,
      last_made INTEGER
    );

    -- Each Context whose object is stuck on an upgrade (section 11), as it or the daily Backup last
    -- said, and the release it is stuck under. A standing Notice in every other Context while it is
    -- here.
    CREATE TABLE IF NOT EXISTS stuck_contexts (
      context_id TEXT PRIMARY KEY,
      release TEXT NOT NULL
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
  const backedUp = sql
    .exec(`SELECT 1 FROM pragma_table_info('contexts') WHERE name = 'backed_up'`)
    .toArray().length;
  if (backedUp === 0) {
    sql.exec(`ALTER TABLE contexts ADD COLUMN backed_up INTEGER`);
    // Every Backup made before this held every Context listed, so the last one made holds each.
    sql.exec(`UPDATE contexts SET backed_up = (SELECT last_made FROM backups)`);
  }
}
