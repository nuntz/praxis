// Step 4 of a Context's object's upgrade ladder (section 11, ADR 0019). Released: never edited,
// dropped or squashed. A fix is a new step. It imports nothing, so nothing outside it can change
// what it does (lint/steps.test.ts).
//
// The record of a Connection's calls (sections 7.3 and 10.5): one row per call a Connection made
// to this Context, reads included, holding none of what it sent or was given. Nothing kept calls
// before this step, so there is nothing to fill.

export default function contextStep4(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS connection_calls (
      seq INTEGER PRIMARY KEY,
      -- When the call arrived, by the object's clock.
      at INTEGER NOT NULL,
      -- The Connection, by its id, the name it had when it called, and whether it read only:
      -- connection or read_only_connection.
      caller_kind TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      connection_name TEXT NOT NULL,
      -- The tool it called, or null for a name that is no tool of Praxis's.
      tool TEXT,
      -- ok, or the code of the error it was answered with.
      result TEXT NOT NULL,
      -- How many records came back.
      records INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS connection_calls_at ON connection_calls (at);
    CREATE INDEX IF NOT EXISTS connection_calls_by ON connection_calls (connection_id, seq);
  `);
}
