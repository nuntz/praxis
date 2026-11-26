import {
  type Day,
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

/** Whether a Task's rule is one offered, whatever day it counts from. */
export function sameRule(held: Recurrence, offered: NewRecurrence): boolean {
  if (held.kind !== offered.kind || held.every !== offered.every) return false;
  if (held.kind === "weeks" && offered.kind === "weeks")
    return held.on.join() === offered.on.join();
  if (held.kind === "months" && offered.kind === "months") return held.on === offered.on;
  if (held.kind === "interval" && offered.kind === "interval") return held.unit === offered.unit;
  return true;
}
