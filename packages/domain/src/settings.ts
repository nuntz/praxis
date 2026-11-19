import { z } from "zod";
import type { Day } from "./day.ts";
import { type Weekday, weekdays } from "./recurrence.ts";

/** What a Context is made with, by the Deployment object (section 4.11). */
export type ContextMade = { name: string; time_zone: string };

/**
 * A Context's settings as `get_settings` gives them to every caller (section 4.10), with today's
 * date in its time zone so a caller can resolve "next Friday" for itself.
 */
export type Settings = {
  name: string;
  /** A zone of the IANA database, such as `Europe/Paris`. */
  time_zone: string;
  /** The current day in that time zone. */
  today: Day;
  /** When the Brief comes each day, in the Context's time zone, or null when it is off (section 5.4). */
  brief_time: ClockTime | null;
  /** The day of the week the Review comes on, kept while it is off so switching it on keeps it. */
  review_day: Weekday;
  /** When the Review comes on its day, in the Context's time zone, or null when it is off. */
  review_time: ClockTime | null;
  /**
   * The Context's one Notification switch, covering its Brief and its Review (section 8.7). On for
   * a new Context: a Device is sent nothing until Notifications are switched on there too.
   */
  notifications: boolean;
};

/** A Review's day: a day of the week, named as a Recurrence names it. */
export const weekday = z.enum(weekdays, {
  message: `A day of the week is one of ${weekdays.join(", ")}.`,
});

/** A time of day on the 24-hour clock, `HH:MM`, read in the Context's time zone. */
export type ClockTime = string;

export const clockTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, {
  message: "A time of day is written HH:MM on the 24-hour clock, such as 07:00.",
});

/** When a new Context's Brief and Review come: the Brief at 07:00, the Review on Sunday at 17:00. */
export const FIRST_TIMES = {
  brief_time: "07:00",
  review_day: "sunday",
  review_time: "17:00",
} as const;
