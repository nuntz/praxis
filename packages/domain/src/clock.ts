import { addDays, type Day, dayIn, utcMidnight } from "./day.ts";
import { type Weekday, weekdayOf } from "./recurrence.ts";
import type { ClockTime } from "./settings.ts";

/**
 * What the clock starts a Run for (section 5.4): the Brief, once a day, and the Review, once a
 * week, each at a time the person sets for the Context.
 */
export type ClockKind = "brief" | "review";

export const CLOCK_KINDS = ["brief", "review"] as const satisfies readonly ClockKind[];

/** When one kind comes: every day, or on one day of the week, at a time, or never while off. */
export type ClockTimes = { days: "every" | Weekday; time: ClockTime | null };

/** When a kind comes, as a Context's settings say. */
export function clockTimes(
  kind: ClockKind,
  settings: { brief_time: ClockTime | null; review_day: Weekday; review_time: ClockTime | null },
): ClockTimes {
  return kind === "brief"
    ? { days: "every", time: settings.brief_time }
    : { days: settings.review_day, time: settings.review_time };
}

/**
 * The instant a time of day falls at on a day in a time zone. A time summer time skips is read as
 * the instant the same hours after midnight would be; one it repeats, as its first.
 */
export function instantAt(day: Day, time: ClockTime, zone: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  const wall = utcMidnight(day) + (hours * 60 + minutes) * 60 * 1000;
  // The zone's offset at a guess, then at the instant that guess gives, settles in two steps.
  let instant = wall - offsetAt(wall, zone);
  instant = wall - offsetAt(instant, zone);
  return instant;
}

const MINUTE = 60 * 1000;

/**
 * The first instant of a day in a time zone: its midnight, or where summer time skips midnight,
 * the first minute its clock reads on that day. Every instant from it until the next day's is on
 * that day.
 */
export function dayStart(day: Day, zone: string): number {
  const midnight = instantAt(day, "00:00", zone);
  if (dayIn(midnight, zone) >= day) return midnight;
  // Read as the hour before, on the day before: the day starts within the hours skipped.
  let before = midnight;
  let on = midnight + 3 * 60 * MINUTE;
  while (on - before > MINUTE) {
    const between = before + Math.floor((on - before) / MINUTE / 2) * MINUTE;
    if (dayIn(between, zone) >= day) on = between;
    else before = between;
  }
  return on;
}

/** How far a zone's wall clock stands ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - (instant - (instant % 1000));
}

/** Whether a kind comes on this day. */
function comesOn(days: ClockTimes["days"], day: Day): boolean {
  return days === "every" || weekdayOf(day) === days;
}

/**
 * The newest time a kind came at or before `at`, or null while it is off. A Run that could not
 * happen then happens as soon as it can, and is dropped once the next one is due: the next is then
 * the newest.
 */
export function latestDue(times: ClockTimes, zone: string, at: number): number | null {
  const { time, days } = times;
  if (time === null) return null;
  const today = dayIn(at, zone);
  for (let back = 0; back <= 8; back += 1) {
    const day = addDays(today, -back);
    if (!comesOn(days, day)) continue;
    const due = instantAt(day, time, zone);
    if (due <= at) return due;
  }
  return null;
}

/** The first time a kind comes after `after`, or null while it is off. */
export function nextDue(times: ClockTimes, zone: string, after: number): number | null {
  const { time, days } = times;
  if (time === null) return null;
  const today = dayIn(after, zone);
  for (let on = -1; on <= 8; on += 1) {
    const day = addDays(today, on);
    if (!comesOn(days, day)) continue;
    const due = instantAt(day, time, zone);
    if (due > after) return due;
  }
  return null;
}
