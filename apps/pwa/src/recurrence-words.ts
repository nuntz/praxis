import {
  addDays,
  type Day,
  daysBetween,
  type NewRecurrence,
  type Recurrence,
  utcMidnight,
  type Weekday,
  weekdays,
} from "@praxis/domain";

/**
 * A Recurrence said in words, as a Task's page shows it (section 3.5), and the ones offered there,
 * each read from the Task's Due Date, which a schedule counts from.
 */

const WEEKDAY_NAMES: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const UNIT: Record<"days" | "weeks" | "months" | "years", [string, string]> = {
  days: ["day", "days"],
  weeks: ["week", "weeks"],
  months: ["month", "months"],
  years: ["year", "years"],
};

/** A day and month as the Device's locale writes them, as a yearly rule falls on. */
const dayAndMonth = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function every(count: number, unit: keyof typeof UNIT): string {
  const [one, many] = UNIT[unit];
  return count === 1 ? `Every ${one}` : `Every ${count} ${many}`;
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const last2 = n % 100;
  return `${n}${suffixes[(last2 - 20) % 10] ?? suffixes[last2] ?? "th"}`;
}

function listed(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A rule in words: "Every 2 weeks on Monday", "A month after it is closed". */
export function recurrenceWords(rule: NewRecurrence | Recurrence, from?: Day): string {
  switch (rule.kind) {
    case "days":
      return every(rule.every, "days");
    case "weeks":
      return `${every(rule.every, "weeks")} on ${listed(rule.on.map((day) => WEEKDAY_NAMES[day]))}`;
    case "months":
      return `${every(rule.every, "months")} on the ${rule.on === "last" ? "last day" : ordinal(rule.on)}`;
    case "years": {
      const day = "from" in rule ? rule.from : from;
      return day
        ? `${every(rule.every, "years")} on ${dayAndMonth.format(utcMidnight(day))}`
        : every(rule.every, "years");
    }
    case "interval": {
      const [one, many] = UNIT[rule.unit];
      const span = rule.every === 1 ? `A ${one}` : `${rule.every} ${many}`;
      return `${span} after it is finished or dropped`;
    }
  }
}

/** The weekday a day falls on. */
function weekdayOf(day: Day): Weekday {
  return weekdays[(new Date(utcMidnight(day)).getUTCDay() + 6) % 7] as Weekday;
}

/**
 * The rules offered for a Task due on `due`: on a schedule from that day, or counted from the day
 * it is closed. Other rules, such as one the Agent set, are shown as the Task's own.
 */
export function recurrencesOffered(due: Day): NewRecurrence[] {
  const weekday = weekdayOf(due);
  return [
    { kind: "days", every: 1 },
    { kind: "weeks", every: 1, on: [weekday] },
    { kind: "weeks", every: 2, on: [weekday] },
    { kind: "months", every: 1, on: new Date(utcMidnight(due)).getUTCDate() },
    { kind: "years", every: 1 },
    { kind: "interval", every: 1, unit: "weeks" },
    { kind: "interval", every: 1, unit: "months" },
  ];
}

/** The Monday of the week a day falls in: weeks run Monday to Sunday (section 3.5). */
function mondayOf(day: Day): Day {
  return addDays(day, -((new Date(utcMidnight(day)).getUTCDay() + 6) % 7));
}

/** How many calendar months lie from one day's month to another's. */
function monthsBetween(from: Day, to: Day): number {
  const [a, b] = [new Date(utcMidnight(from)), new Date(utcMidnight(to))];
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
}

/**
 * Whether a Task's rule makes the same Occurrences as one offered from its Due Date, `due`. A
 * schedule counts from the day it was set (section 3.5), so the same words can name another
 * schedule once the Due Date has moved: every year on another day, every 2 weeks in the other
 * week. An interval counts from the day it is closed, whatever day it was set.
 */
export function sameRule(held: Recurrence, offered: NewRecurrence, due: Day): boolean {
  if (held.kind !== offered.kind || held.every !== offered.every) return false;
  if (held.kind === "interval" || offered.kind === "interval") {
    return held.kind === "interval" && offered.kind === "interval" && held.unit === offered.unit;
  }
  const every = held.every;
  switch (held.kind) {
    case "days":
      return daysBetween(held.from, due) % every === 0;
    case "weeks":
      return (
        offered.kind === "weeks" &&
        held.on.join() === offered.on.join() &&
        daysBetween(mondayOf(held.from), mondayOf(due)) % (7 * every) === 0
      );
    case "months":
      return (
        offered.kind === "months" &&
        held.on === offered.on &&
        monthsBetween(held.from, due) % every === 0
      );
    case "years":
      return (
        held.from.slice(5) === due.slice(5) &&
        (Number(due.slice(0, 4)) - Number(held.from.slice(0, 4))) % every === 0
      );
  }
}
