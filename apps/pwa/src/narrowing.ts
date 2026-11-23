import { addDays, type Day } from "@praxis/domain";
import { daysSaid } from "./days.tsx";

/**
 * What the chips under the search field narrow a search to (section 8.4), each chip one field, and
 * null while it is not set. It is the one state the chips hold, and it maps onto the `search`
 * tool's narrowing inputs (section 9.4) by `narrowingInputs`.
 */
export type Narrowing = {
  time: TimeNarrowing | null;
  /** The Project, sent as `project_id`, and its name as the chip says it. */
  project: RecordNarrowing | null;
  // #123 adds the Person, sent as `person_id`.
  // #124 adds the Author, sent as `author`.
};

/** A search narrowed by nothing: every chip not set. */
export const NOT_NARROWED: Narrowing = { time: null, project: null };

/** A record a chip narrows a search to: its id, and its name as the chip says it. */
export type RecordNarrowing = { id: string; name: string };

/**
 * Whether a narrowing lists what it holds with no words: a Project chip does, and a Person or an
 * Author chip will, where a time chip alone lists nothing until there are words (section 8.4).
 */
export function standsAlone(narrowing: Narrowing): boolean {
  // #123 and #124 add the Person and the Author.
  return narrowing.project !== null;
}

/**
 * What the count says of a narrowing that lists everything it holds with no words, newest first,
 * or null for one that does not.
 */
export function everythingSaid(narrowing: Narrowing): string | null {
  // #123 and #124 say a Person's and an Author's, and what several chips set together hold.
  if (narrowing.project !== null) return `Everything in ${narrowing.project.name}, newest first`;
  return null;
}

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
export type NarrowingInputs = { from?: Day; to?: Day; project_id?: string };

/**
 * The `search` tool's narrowing inputs for a narrowing, its presets reckoned from today in the
 * Context's zone: a chip not set sends nothing.
 */
export function narrowingInputs(narrowing: Narrowing, today: Day): NarrowingInputs {
  return {
    ...timeInputs(narrowing.time, today),
    ...(narrowing.project === null ? {} : { project_id: narrowing.project.id }),
  };
}

function timeInputs(time: TimeNarrowing | null, today: Day): NarrowingInputs {
  if (time === null) return {};
  if (time.kind === "range") return { from: time.from, to: time.to };
  return { from: addDays(today, 1 - time.days), to: today };
}

/** Whether a narrowing has any chip set. */
export function isNarrowed(narrowing: Narrowing): boolean {
  return Object.values(narrowing).some((held) => held !== null);
}

/** The narrowing with one chip lifted, the others as they were. */
export function lifted(narrowing: Narrowing, chip: keyof Narrowing): Narrowing {
  return { ...narrowing, [chip]: null };
}

/** What the time chip says it holds once set: "Last 7 days", or its range's days. */
export function timeSaid(time: TimeNarrowing, today: Day): string {
  return time.kind === "last" ? lastDaysSaid(time.days) : daysSaid(time.from, time.to, today);
}

/**
 * What a chip set offers when nothing is found (section 8.4): a line saying what it keeps out of
 * the search, and its offer, a button that lifts it.
 */
export type Lift = { chip: keyof Narrowing; kept: string; offer: string };

/**
 * Each chip's line and offer once set, in one place and in the chips' order, so no chip added to
 * the narrowing goes without one.
 */
const LIFTS: {
  [Chip in keyof Narrowing]: (held: NonNullable<Narrowing[Chip]>, today: Day) => Omit<Lift, "chip">;
} = {
  time: (time, today) => ({ kept: timeKept(time, today), offer: "Search any time" }),
  project: (project) => ({
    kept: `Only what is in ${project.name} is searched.`,
    offer: "Search every Project",
  }),
  // #123 adds the Person's: "Nothing about <Person> holds it.", "Search every Person".
  // #124 adds the Author's: "Nothing by <Author> holds it.", "Search every Author".
};

/** What the time chip keeps out of the search. */
function timeKept(time: TimeNarrowing, today: Day): string {
  if (time.kind === "range") return `Nothing outside ${timeSaid(time, today)} is searched.`;
  if (time.days === 1) return "Nothing before today is searched.";
  return `Nothing older than ${time.days} days is searched.`;
}

/** The offers to lift each chip set, in the chips' order. */
export function liftsOf(narrowing: Narrowing, today: Day): Lift[] {
  return (Object.keys(LIFTS) as (keyof Narrowing)[]).flatMap((chip) => {
    const lift = liftOf(chip, narrowing, today);
    return lift === null ? [] : [lift];
  });
}

function liftOf<Chip extends keyof Narrowing>(
  chip: Chip,
  narrowing: Narrowing,
  today: Day,
): Lift | null {
  const held = narrowing[chip];
  if (held === null) return null;
  return { chip, ...LIFTS[chip](held, today) };
}
