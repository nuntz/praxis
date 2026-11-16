import {
  type ContextMade,
  dayIn,
  type Effect,
  namedZone,
  type Settings,
  UNMADE_CONTEXT,
} from "@praxis/domain";

type SettingsRow = { id: string; name: string; time_zone: string };

/** Give a Context its settings row, as an unmade Context, unless it has one. */
export function seedSettings(sql: SqlStorage, id: string): void {
  sql.exec(
    `INSERT OR IGNORE INTO context_settings (id, name, time_zone) VALUES (?, ?, ?)`,
    id,
    UNMADE_CONTEXT.name,
    UNMADE_CONTEXT.time_zone,
  );
}

/** Make the Context with its name and time zone, as the Deployment object does. */
export function makeContext(sql: SqlStorage, made: ContextMade): void {
  const zone = namedZone(made.time_zone);
  if (zone === null) throw new Error("A Context is made with a time zone of the IANA database");
  sql.exec(`UPDATE context_settings SET name = ?, time_zone = ?`, made.name, zone);
}

/** The Context's time zone. */
export function timeZoneOf(sql: SqlStorage): string {
  return row(sql).time_zone;
}

export function setTimeZone(sql: SqlStorage, zone: string): void {
  sql.exec(`UPDATE context_settings SET time_zone = ?`, zone);
}

/** The Context's settings as callers read them, with today as at `at`. */
export function readSettings(sql: SqlStorage, at: number): Settings {
  const { name, time_zone } = row(sql);
  return { name, time_zone, today: dayIn(at, time_zone) };
}

/** The Effect of a call on the Context's settings, summarised by the Context's name. */
export function contextEffect(sql: SqlStorage): Effect {
  const { id, name } = row(sql);
  return { kind: "context", id, what: "changed", summary: name, by: "call" };
}

function row(sql: SqlStorage): SettingsRow {
  return sql.exec<SettingsRow>(`SELECT id, name, time_zone FROM context_settings`).one();
}
