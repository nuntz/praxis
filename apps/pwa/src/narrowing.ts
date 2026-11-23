import { addDays, type Day } from "@praxis/domain";

/**
 * What the chips under the search field narrow a search to (section 8.4), each chip one field, and
 * null while it is not set. It is the one state the chips hold, and it maps onto the `search`
 * tool's narrowing inputs (section 9.4) by `narrowingInputs`.
 */
export type Narrowing = {
  time: TimeNarrowing | null;
  // #122 adds the Project, sent as `project_id`.
  // #123 adds the Person, sent as `person_id`.
  // #124 adds the Author, sent as `author`.
};

/** A search narrowed by nothing: every chip not set. */
export const NOT_NARROWED: Narrowing = { time: null };

/**
 * The days the time chip keeps a search to: the last few days up to today, today among them, or a
 * range of days, both ends included. Days are the Context's, reckoned in its time zone.
 */
export type TimeNarrowing =
  | { kind: "last"; days: LastDays }
  | { kind: "range"; from: Day; to: Day };

/** How many days back the time chip's presets reach, today the last of them. */
export type LastDays = 1 | 7 | 30;

/** The time chip's presets, in the order offered. */
export const LAST_DAYS: LastDays[] = [1, 7, 30];

/** What a preset of the time chip is called, offered and once set. */
export function lastDaysSaid(days: LastDays): string {
  return days === 1 ? "Today" : `Last ${days} days`;
}

/** The `search` tool's inputs that narrow it, as a narrowing sets them. */
export type NarrowingInputs = { from?: Day; to?: Day };

/**
 * The `search` tool's narrowing inputs for a narrowing, its presets reckoned from today in the
 * Context's zone: a chip not set sends nothing.
 */
export function narrowingInputs(narrowing: Narrowing, today: Day): NarrowingInputs {
  const time = narrowing.time;
  if (time === null) return {};
  if (time.kind === "range") return { from: time.from, to: time.to };
  return { from: addDays(today, 1 - time.days), to: today };
}
