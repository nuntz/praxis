import { z } from "zod";

/**
 * A day, as a Due Date and a Defer Date are: `YYYY-MM-DD`, never a time of day. Days written so
 * compare as text in the order they fall.
 */
export type Day = string;

/** A day in tool input: a real calendar date, never prose such as "next Friday" (section 4.3). */
export const day = z.iso.date({
  message: 'A date is a day written YYYY-MM-DD, never prose: resolve "next Friday" first.',
});

/**
 * A Context's time zone: a zone of the IANA database, such as `Europe/Paris`, never a bare offset,
 * since an offset knows nothing of summer time. Kept as the runtime names it.
 */
export const timeZone = z.string().transform((value, context) => {
  const named = namedZone(value);
  if (named === null) {
    context.addIssue({
      code: "custom",
      message: "A time zone is one of the IANA database, such as Europe/Paris.",
    });
    return z.NEVER;
  }
  return named;
});

/** The runtime's own name for a zone of the IANA database, or null when it is none. */
export function namedZone(value: string): string | null {
  if (/^[+-]/.test(value.trim())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The day an instant falls on in a time zone: "today", when the instant is now (section 3.4). */
export function dayIn(instant: number, zone: string): Day {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The day `days` after this one, by the calendar. */
export function addDays(from: Day, days: number): Day {
  return new Date(utcMidnight(from, days)).toISOString().slice(0, 10);
}

/** Days from one day to another by the calendar, negative when it comes before. */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / (24 * 60 * 60 * 1000));
}

/**
 * Midnight in UTC at the start of a day, `days` on, in milliseconds since the epoch. A day has no
 * time zone of its own: this only lets the calendar and a formatter in UTC read it.
 */
export function utcMidnight(day: Day, days = 0): number {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date + days);
}
