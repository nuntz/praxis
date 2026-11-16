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
};

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
