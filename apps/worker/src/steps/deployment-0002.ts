// Step 2 of the Deployment object's upgrade ladder (section 11, ADR 0019). Released: never edited,
// dropped or squashed. A fix is a new step. It imports nothing, so nothing outside it can change
// what it does (lint/steps.test.ts).
//
// The Call going in the Deployment, and the voice provider refusing the voice key (section 6). An
// object made before it was never told of a Call, so there is nothing to fill: a Call going in a
// Context as it climbs is ended by that Context's object once its Device has sent no sign of life
// for too long.

export default function deploymentStep2(sql: SqlStorage): void {
  sql.exec(`
    -- The one Call going in the Deployment: the Context it is in and its id there. Starting
    -- another, in any Context, ends it.
    CREATE TABLE IF NOT EXISTS call_going (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      context_id TEXT NOT NULL,
      call TEXT NOT NULL
    );

    -- The voice provider refusing the voice key: one row, from the first Call it refused until
    -- one is set up. A standing Notice in every Context while it is there.
    CREATE TABLE IF NOT EXISTS voice_key_refused (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      since INTEGER NOT NULL
    );
  `);
}
