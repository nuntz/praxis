import type { Author } from "./callers.ts";
import type { Link } from "./link.ts";
import type { Task } from "./task.ts";

/** An Entry as every read and write returns it (section 3.2), with its Tasks. */
export type Entry = {
  id: string;
  /** Plain text, exactly as typed. */
  words: string;
  /** When it was made, as an ISO 8601 instant. */
  at: string;
  author: Author;
  /** Whether it came through the Conversation. */
  through_conversation: boolean;
  /** The Tasks it is the Origin Entry of, in the order they were made. */
  tasks: Task[];
  /** Its References and Mentions, kept beside the words, in the order they were added. */
  links: Link[];
  /**
   * The Version its words are at: how many times they have changed. A change to them states it,
   * and is `stale` once it is no longer current.
   */
  version: number;
  /** The last change to its words, or null when they never changed. */
  edited: WordsChange | null;
  /** The one earlier Entry it continues or corrects, if any: its Follow-up link. */
  follow_up_to: EntryNamed | null;
  /** The later Entries that are Follow-ups to it, in the order they were made. */
  follow_ups: EntryNamed[];
  /** Whether it is a Standing Entry, which the Agent is given at the start of every Run. */
  standing: boolean;
};

/** A change to an Entry's words: who made it, and when it arrived, as an ISO 8601 instant. */
export type WordsChange = { by: Author; at: string };

/**
 * An Entry as another Entry names it: its id and its one-line summary, marked `deleted` while it
 * is in the Trash, as a Follow-up's link to it is then (section 3.8).
 */
export type EntryNamed = { id: string; summary: string; deleted?: true };

/**
 * The words an Entry had before a change to them (section 3.2), numbered as the Entry's `version`
 * was while it had them, with the change that replaced them.
 */
export type Version = { version: number; words: string; changed: WordsChange };

/** A page of a list, read by cursor (section 4.9). `next_cursor` is null on the last page. */
export type Page<T> = { items: T[]; next_cursor: string | null };

/** Lists are paged by cursor, 50 by default. */
export const PAGE_SIZE = 50;

/** An instant held as milliseconds since the epoch, given to callers as ISO 8601. */
export function instantToIso(ms: number): string {
  return new Date(ms).toISOString();
}

const SUMMARY_LENGTH = 80;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The most a Context's Standing Entries hold in all, in characters as seen (section 5.5): a
 * ceiling on their size, not their number, since the Agent is given them on every Run.
 */
export const STANDING_CEILING = 10_000;

/** How much of the ceiling an Entry's words take: their characters as seen. */
export function standingSize(words: string): number {
  let size = 0;
  for (const _ of graphemes.segment(words)) size++;
  return size;
}

/** An Entry's one-line summary: its first line with words, cut at 80 characters as seen. */
export function summarizeWords(words: string): string {
  const line =
    words
      .split(/\r\n|\r|\n/)
      .map((each) => each.replace(/\s+/g, " ").trim())
      .find((each) => each.length > 0) ?? "";
  const characters = Array.from(graphemes.segment(line), (each) => each.segment);
  if (characters.length <= SUMMARY_LENGTH) return line;
  return `${characters
    .slice(0, SUMMARY_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}
