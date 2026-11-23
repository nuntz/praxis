import { addDays, type Day, type ToolInput } from "@praxis/domain";
import { authorName } from "./authors.ts";
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
  /** The Person, sent as `person_id`, and their name as the chip says it. */
  person: RecordNarrowing | null;
  /** The Author, sent as `author`: the person, the Agent, any Connection or one by its name. */
  author: AuthorNarrowing | null;
};

/** A search narrowed by nothing: every chip not set. */
export const NOT_NARROWED: Narrowing = { time: null, project: null, person: null, author: null };

/** A record a chip narrows a search to: its id, and its name as the chip says it. */
export type RecordNarrowing = { id: string; name: string };

/** An Author a search is narrowed to, as the `search` tool takes it: no name is any Connection. */
export type AuthorNarrowing = NonNullable<ToolInput<"search">["author"]>;

/** An Author the chip narrows to, as the screen names them: "you", "any Connection". */
function authorSaid(author: AuthorNarrowing): string {
  if (author.kind !== "connection") return authorName(author);
  return author.name ?? "any Connection";
}

/**
 * The days the time chip keeps a search to: the last few days up to today, today among them, or a
 * range of days, both ends included. Days are the Context's, reckoned in its time zone.
 */
export type TimeNarrowing =
  | { kind: "last"; days: LastDays }
  | { kind: "range"; from: Day; to: Day };

/** How many days back the time chip's presets reach, today the last of them. */
type LastDays = 1 | 7 | 30;

/** The time chip's presets, in the order offered. */
export const LAST_DAYS: LastDays[] = [1, 7, 30];

/** What a preset of the time chip is called, offered and once set. */
export function lastDaysSaid(days: LastDays): string {
  return days === 1 ? "Today" : `Last ${days} days`;
}

/** The `search` tool's inputs that narrow it, as a narrowing sets them. */
type NarrowingInputs = {
  from?: Day;
  to?: Day;
  project_id?: string;
  person_id?: string;
  author?: AuthorNarrowing;
};

/**
 * The `search` tool's narrowing inputs for a narrowing, its presets reckoned from today in the
 * Context's zone: a chip not set sends nothing.
 */
export function narrowingInputs(narrowing: Narrowing, today: Day): NarrowingInputs {
  return {
    ...timeInputs(narrowing.time, today),
    ...(narrowing.project === null ? {} : { project_id: narrowing.project.id }),
    ...(narrowing.person === null ? {} : { person_id: narrowing.person.id }),
    ...(narrowing.author === null ? {} : { author: narrowing.author }),
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
function timeSaid(time: TimeNarrowing, today: Day): string {
  return time.kind === "last" ? lastDaysSaid(time.days) : daysSaid(time.from, time.to, today);
}

/** What a chip set says of what it holds, wherever the screen says it (section 8.4). */
type ChipSaid = {
  chip: keyof Narrowing;
  /** What the chip itself says: "By Claude Code". */
  shown: string;
  /** What a screen reader hears the chip named before "remove": "Author: Claude Code". */
  named: string;
  /** Under Nothing found, what it keeps out of the search. */
  kept: string;
  /** Under Nothing found, its offer: a button that lifts it. */
  offer: string;
  /** What the count of a list with no words says of it: "from today", "by Claude Code". */
  everything: string;
};

/**
 * Each chip's wording once set, in one place and in the chips' order, the order the row shows
 * them in, so no chip added to the narrowing goes without its own.
 */
const SAID: {
  [Chip in keyof Narrowing]: (
    held: NonNullable<Narrowing[Chip]>,
    today: Day,
  ) => Omit<ChipSaid, "chip">;
} = {
  time: (time, today) => {
    const said = timeSaid(time, today);
    return {
      shown: said,
      named: said,
      kept: timeKept(time, today),
      offer: "Search any time",
      everything: `from ${timeEverything(time, today)}`,
    };
  },
  project: (project) => ({
    shown: project.name,
    named: `Project: ${project.name}`,
    kept: `Only what is in ${project.name} is searched.`,
    offer: "Search every Project",
    everything: `in ${project.name}`,
  }),
  person: (person) => ({
    shown: person.name,
    named: `Person: ${person.name}`,
    kept: `Only what is about ${person.name} is searched.`,
    offer: "Search every Person",
    everything: `about ${person.name}`,
  }),
  author: (author) => {
    const said = authorSaid(author);
    return {
      shown: `By ${said}`,
      named: `Author: ${said}`,
      kept: `Only what ${said} made is searched.`,
      offer: "Search every Author",
      everything: `by ${said}`,
    };
  },
};

/** The chips, in the order the row shows them and the screen says what each holds. */
export const CHIPS = Object.keys(SAID) as (keyof Narrowing)[];

/** What the count of a list with no words says the time chip holds, after "from". */
function timeEverything(time: TimeNarrowing, today: Day): string {
  if (time.kind === "range") return timeSaid(time, today);
  return time.days === 1 ? "today" : `the last ${time.days} days`;
}

/** What the time chip keeps out of the search. */
function timeKept(time: TimeNarrowing, today: Day): string {
  if (time.kind === "range") return `Nothing outside ${timeSaid(time, today)} is searched.`;
  if (time.days === 1) return "Nothing before today is searched.";
  return `Nothing older than ${time.days} days is searched.`;
}

/** What one chip says of what it holds, or null while it is not set. */
export function chipSaid<Chip extends keyof Narrowing>(
  chip: Chip,
  narrowing: Narrowing,
  today: Day,
): ChipSaid | null {
  const held = narrowing[chip];
  if (held === null) return null;
  return { chip, ...SAID[chip](held as NonNullable<Narrowing[Chip]>, today) };
}

/** What each chip set says of what it holds, in the chips' order. */
export function chipsSaid(narrowing: Narrowing, today: Day): ChipSaid[] {
  return CHIPS.flatMap((chip) => chipSaid(chip, narrowing, today) ?? []);
}

/**
 * What the count of a list with no words says, everything its chips hold in the chips' order,
 * newest first: "Everything from the last 7 days in Garden about Ana by Claude Code, newest first".
 */
export function everythingSaid(narrowing: Narrowing, today: Day): string {
  const held = chipsSaid(narrowing, today).map(({ everything }) => everything);
  return `${["Everything", ...held].join(" ")}, newest first`;
}
