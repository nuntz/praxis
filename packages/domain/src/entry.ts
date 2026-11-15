import type { Author } from "./callers.ts";

/** An Entry as every read and write returns it (section 3.2). */
export type Entry = {
  id: string;
  /** Plain text, exactly as typed. */
  words: string;
  /** When it was made, as an ISO 8601 instant. */
  at: string;
  author: Author;
  /** Whether it came through the Conversation. */
  through_conversation: boolean;
};

/** A page of a list, read by cursor (section 4.9). `next_cursor` is null on the last page. */
export type Page<T> = { items: T[]; next_cursor: string | null };

/** Lists are paged by cursor, 50 by default. */
export const PAGE_SIZE = 50;

/** An instant held as milliseconds since the epoch, given to callers as ISO 8601. */
export function instantToIso(ms: number): string {
  return new Date(ms).toISOString();
}
