import {
  type ContextMade,
  dayIn,
  type Effect,
  effectOnContext,
  namedZone,
  type Settings,
  type Weekday,
} from "@praxis/domain";

type SettingsRow = {
  id: string;
  name: string;
  time_zone: string;
  brief_time: string | null;
  review_day: Weekday;
  review_time: string | null;
  notifications: number;
};

/**
 * Make the Context with its id, name and time zone, as the Deployment object does on
 * `create_context`. Making it again, as a retry would, makes it as given.
 */
export function makeContext(
  sql: SqlStorage,
  id: string,
  made: ContextMade,
  deployment: string,
): void {
  const zone = namedZone(made.time_zone);
  if (zone === null) throw new Error("A Context is made with a time zone of the IANA database");
  sql.exec(
    `INSERT OR REPLACE INTO context_settings (id, name, time_zone, deployment) VALUES (?, ?, ?, ?)`,
    id,
    made.name,
    zone,
    deployment,
  );
}

/** The id of the Deployment object that made the Context, or null for one made before it was kept. */
export function deploymentOfContext(sql: SqlStorage): string | null {
  return (
    sql.exec<{ deployment: string | null }>(`SELECT deployment FROM context_settings`).toArray()[0]
      ?.deployment ?? null
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

/** Set when the Brief comes, or switch it off with null. */
export function setBriefTime(sql: SqlStorage, time: string | null): void {
  sql.exec(`UPDATE context_settings SET brief_time = ?`, time);
}

/** Set the Review's day and time, or switch it off with a null time, keeping its day. */
export function setReviewTime(sql: SqlStorage, day: Weekday, time: string | null): void {
  sql.exec(`UPDATE context_settings SET review_day = ?, review_time = ?`, day, time);
}

/** Switch the Context's Notifications on or off. */
export function setNotifications(sql: SqlStorage, on: boolean): void {
  sql.exec(`UPDATE context_settings SET notifications = ?`, on ? 1 : 0);
}

export function setTimeZone(sql: SqlStorage, zone: string): void {
  sql.exec(`UPDATE context_settings SET time_zone = ?`, zone);
}

/** The Context's settings as callers read them, with today as at `at`. */
export function readSettings(sql: SqlStorage, at: number): Settings {
  const { name, time_zone, brief_time, review_day, review_time, notifications } = row(sql);
  return {
    name,
    time_zone,
    today: dayIn(at, time_zone),
    brief_time,
    review_day,
    review_time,
    notifications: notifications === 1,
  };
}

/** The Effect of a call on the Context's settings, summarised by the Context's name. */
export function contextEffect(sql: SqlStorage): Effect {
  return effectOnContext(row(sql), "changed");
}

function row(sql: SqlStorage): SettingsRow {
  return sql
    .exec<SettingsRow>(
      `SELECT id, name, time_zone, brief_time, review_day, review_time, notifications
       FROM context_settings`,
    )
    .one();
}
