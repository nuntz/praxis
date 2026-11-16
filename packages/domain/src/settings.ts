import type { Day } from "./day.ts";

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
};
