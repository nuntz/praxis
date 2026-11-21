// Step 2 of a Context's object's upgrade ladder (section 11, ADR 0019). Released: never edited,
// dropped or squashed. A fix is a new step. It imports nothing, so nothing outside it can change
// what it does (lint/steps.test.ts).
//
// The Calls (section 6): one row per Call set up in this Context, which holds no words. An object
// made before it has had no Call, so there is nothing to fill.

export default function contextStep2(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      -- The voice provider's id for the session, by which the object ends one the Device did not.
      session TEXT NOT NULL,
      -- When the object set it up, and when its end was reported, by the object's clock.
      at INTEGER NOT NULL,
      ended_at INTEGER,
      -- How it ended: hung_up, provider_ended, lost or replaced; null while it goes on.
      ended TEXT,
      -- Why the provider says it ended the session, as the Device or the object heard it.
      provider_reason TEXT,
      -- Who heard the provider end it: device or object, or null.
      end_heard_by TEXT
    );
    CREATE INDEX IF NOT EXISTS calls_going ON calls (ended);
  `);
}
