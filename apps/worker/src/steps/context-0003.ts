// Step 3 of a Context's object's upgrade ladder (section 11, ADR 0019). Released: never edited,
// dropped or squashed. A fix is a new step. It imports nothing, so nothing outside it can change
// what it does (lint/steps.test.ts).
//
// A Call's sign of life and its cost (section 6). A Call set up before this step is taken to have
// last shown a sign of life when it was set up, as the code that writes it would have, so one still
// going is ended by the object's alarm once its Device has been silent too long. One ended is given
// the cost the code would have counted: its whole seconds, by the object's clock, at the price
// GPT-Live-1.1 had when this step was released, five cents a minute. A column already there, as on
// an object climbing from before the ladder, is left as it is.

export default function contextStep3(sql: SqlStorage): void {
  // When the Device last sent a sign of life, by the object's clock.
  addColumn(sql, "alive_at", "INTEGER");
  // What it cost in US dollars, once it has ended; null while it goes on.
  addColumn(sql, "cost", "REAL");
  sql.exec(`
    UPDATE calls SET alive_at = at WHERE alive_at IS NULL;
    UPDATE calls SET cost = ((ended_at - at + 999) / 1000) * 0.05 / 60
      WHERE ended_at IS NOT NULL AND cost IS NULL;
  `);
}

function addColumn(sql: SqlStorage, column: string, type: string): void {
  const has = sql
    .exec(`SELECT 1 FROM pragma_table_info('calls') WHERE name = ?`, column)
    .toArray().length;
  if (has === 0) sql.exec(`ALTER TABLE calls ADD COLUMN ${column} ${type}`);
}
