// Step 3 of the Deployment object's upgrade ladder (section 11, ADR 0019). Released: never edited,
// dropped or squashed. A fix is a new step. It imports nothing, so nothing outside it can change
// what it does (lint/steps.test.ts).
//
// A Device's switch for its Offline Copy (section 8.8), beside the one for Notifications. A Device
// listed before it had only Notifications to switch on, so every row there is filled with the
// copy off, as the code that writes it would have.

export default function deploymentStep3(sql: SqlStorage): void {
  const has = sql
    .exec(`SELECT 1 FROM pragma_table_info('devices') WHERE name = 'offline_copy'`)
    .toArray().length;
  if (has === 0) {
    // Whether the Device keeps an Offline Copy. A row stays while this or Notifications is on.
    sql.exec(`ALTER TABLE devices ADD COLUMN offline_copy INTEGER NOT NULL DEFAULT 0`);
  }
}
