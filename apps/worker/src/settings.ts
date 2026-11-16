import {
  type ContextMade,
  dayIn,
  type Effect,
  effectOnContext,
  namedZone,
  type Settings,
} from "@praxis/domain";

type SettingsRow = { id: string; name: string; time_zone: string };

/**
 * Make the Context with its id, name and time zone, as the Deployment object does on
 * `create_context`. Making it again, as a retry would, makes it as given.
 */
export function makeContext(sql: SqlStorage, id: string, made: ContextMade): void {
  const zone = namedZone(made.time_zone);
  if (zone === null) throw new Error("A Context is made with a time zone of the IANA database");
  sql.exec(
    `INSERT OR REPLACE INTO context_settings (id, name, time_zone) VALUES (?, ?, ?)`,
    id,
    made.name,
    zone,
  );
}

/** Give the Context the name the Deployment object now lists it by. */
export function renameContext(sql: SqlStorage, name: string): void {
  sql.exec(`UPDATE context_settings SET name = ?`, name);
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
  return effectOnContext(row(sql), "changed");
}

function row(sql: SqlStorage): SettingsRow {
  return sql.exec<SettingsRow>(`SELECT id, name, time_zone FROM context_settings`).one();
}
