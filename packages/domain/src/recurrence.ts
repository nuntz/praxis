import { z } from "zod";
import { addDays, type Day, daysBetween, utcMidnight } from "./day.ts";

/**
 * A schedule a Recurrence follows (section 3.5): every N days; every N weeks on chosen weekdays;
 * every N months on a day of the month or its last day; every N years.
 */
export type Schedule =
  | { kind: "days"; every: number }
  | { kind: "weeks"; every: number; on: Weekday[] }
  | { kind: "months"; every: number; on: number | "last" }
  | { kind: "years"; every: number };

/** A Recurrence counted from the day its Occurrence is closed. */
export type Interval = {
  kind: "interval";
  every: number;
  unit: "days" | "weeks" | "months" | "years";
};

/** A Recurrence as `set_recurrence` takes it: a schedule or an interval. */
export type NewRecurrence = Schedule | Interval;

/**
 * A Recurrence as a Task holds it. A schedule counts from the Due Date the Task had when the rule
 * was set, so moving one Occurrence's Due Date moves that Occurrence only: every N days, weeks,
 * months or years runs from that day.
 */
export type Recurrence = (Schedule & { from: Day }) | Interval;

export const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof weekdays)[number];

/** How many days, weeks, months or years a Recurrence steps by. */
export const recurrenceStep = z.int().min(1).max(1000);
const every = recurrenceStep;

/**
 * A Recurrence in tool input. Weekdays are kept once each, in the order of the week, so the same
 * rule given twice is the same rule.
 */
export const newRecurrence = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("days"), every }),
  z.strictObject({
    kind: z.literal("weeks"),
    every,
    on: z
      .array(z.enum(weekdays))
      .min(1, { message: "Every N weeks is on one weekday or more." })
      .transform((on) => weekdays.filter((weekday) => on.includes(weekday))),
  }),
  z.strictObject({
    kind: z.literal("months"),
    every,
    on: z.union([z.int().min(1).max(31), z.literal("last")]),
  }),
  z.strictObject({ kind: z.literal("years"), every }),
  z.strictObject({
    kind: z.literal("interval"),
    every,
    unit: z.enum(["days", "weeks", "months", "years"]),
  }),
]) satisfies z.ZodType<NewRecurrence>;

/**
 * The next Occurrence's Due Date, when the current one, due on `due`, is closed on `closedOn`.
 * For a schedule it is the first date on it after both; for an interval, the closing day plus
 * the interval. A day the month lacks falls on that month's last day.
 */
export function nextDueDate(rule: Recurrence, due: Day, closedOn: Day): Day {
  const after = due > closedOn ? due : closedOn;
  switch (rule.kind) {
    case "days": {
      const steps = Math.floor(daysBetween(rule.from, after) / rule.every) + 1;
      return addDays(rule.from, steps * rule.every);
    }
    case "weeks": {
      // Weeks run Monday to Sunday, and every Nth one from the week of `from` is on it.
      const firstWeek = mondayOf(rule.from);
      for (let day = addDays(after, 1); ; day = addDays(day, 1)) {
        const weeks = daysBetween(firstWeek, mondayOf(day)) / 7;
        if (modulo(weeks, rule.every) === 0 && rule.on.includes(weekdayOf(day))) return day;
      }
    }
    case "months": {
      // Every Nth month from the month of `from`, starting with the one `after` falls in.
      const first = monthIndex(rule.from);
      let month = monthIndex(after);
      month += modulo(first - month, rule.every);
      for (; ; month += rule.every) {
        const day = dayInMonth(month, rule.on === "last" ? 31 : rule.on);
        if (day > after) return day;
      }
    }
    case "years": {
      const [first, monthOf, dateOf] = parts(rule.from);
      let year = parts(after)[0];
      year += modulo(first - year, rule.every);
      for (; ; year += rule.every) {
        const day = dayInMonth(year * 12 + monthOf - 1, dateOf);
        if (day > after) return day;
      }
    }
    case "interval":
      return afterInterval(closedOn, rule);
  }
}

/** The closing day plus an interval, a month later falling on the last day a month has. */
function afterInterval(closedOn: Day, { every, unit }: Interval): Day {
  if (unit === "days") return addDays(closedOn, every);
  if (unit === "weeks") return addDays(closedOn, every * 7);
  const [year, month, date] = parts(closedOn);
  const months = unit === "months" ? every : every * 12;
  return dayInMonth(year * 12 + month - 1 + months, date);
}

/** The year, month (1 to 12) and date of a day. */
function parts(day: Day): [number, number, number] {
  return day.split("-").map(Number) as [number, number, number];
}

/** A month counted from year 0, so months can be stepped through across years. */
function monthIndex(day: Day): number {
  const [year, month] = parts(day);
  return year * 12 + month - 1;
}

/** A date of a month counted from year 0, or the month's last day when it lacks that date. */
function dayInMonth(index: number, date: number): Day {
  const [year, month] = [Math.floor(index / 12), modulo(index, 12)];
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date, last);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The day of the week a day falls on. */
export function weekdayOf(day: Day): Weekday {
  // getUTCDay counts from Sunday; the weekdays run from Monday.
  return weekdays[modulo(new Date(utcMidnight(day)).getUTCDay() - 1, 7)] as Weekday;
}

function mondayOf(day: Day): Day {
  return addDays(day, -weekdays.indexOf(weekdayOf(day)));
}

/** The remainder, never negative. */
function modulo(n: number, by: number): number {
  return ((n % by) + by) % by;
}
