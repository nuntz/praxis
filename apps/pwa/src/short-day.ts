import { type Day, utcMidnight } from "@praxis/domain";

/**
 * A day short, as Attention's rows and a Task's marks say it: the month and day, with the year only
 * when it is not today's. A Day is a date, read at its midnight in UTC, so it has no zone of its own.
 */
export function shortDay(day: Day, today: Day): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(utcMidnight(day));
}
