import type { Author } from "./callers.ts";
import type { Page } from "./entry.ts";

/** A span of an excerpt, in UTF-16 code units as JavaScript counts a string, end not included. */
export type Span = { start: number; end: number };

/**
 * The part of a record's words, title or name that a search found, as plain text on one line,
 * with the spans of the words that matched. It is never rendered as Markdown (section 8.4): an
 * Entry's excerpt is cut from its words and may end inside a link or an emphasis.
 */
export type Excerpt = { text: string; matches: Span[] };

/**
 * One record a search found (section 9.4): its kind and id, its one-line summary as reads give
 * it, when it was made, and the excerpt. An Entry and a Task carry their Author, and a Task the
 * Entry it hangs off. Read the record itself by its id.
 */
export type SearchHit =
  | {
      kind: "entry";
      id: string;
      summary: string;
      at: string;
      author: Author;
      excerpt: Excerpt;
    }
  | {
      kind: "task";
      id: string;
      summary: string;
      at: string;
      author: Author;
      origin_entry: string;
      excerpt: Excerpt;
    }
  | { kind: "project" | "person"; id: string; summary: string; at: string; excerpt: Excerpt };

/**
 * One ranked list of what a search found, best first, a page at a time, from words and from
 * meaning. When meaning was left out, `words_only` says why; it is null when both were used.
 */
export type SearchResults = Page<SearchHit> & { words_only: WordsOnly | null };

/**
 * Why a search answered from words alone, when it did (section 9.4). Meaning applies to Entries,
 * and every caller is told when it was left out, so none takes a list from words for the whole
 * answer:
 *
 * - `missing`: the Deployment has no meaning index, or the index is not there.
 * - `stale`: the Context's meaning index is being built from its Journal, as when it is new to a
 *   release, after `rebuild_search_index`, or once a release changes the embedding model.
 * - `unreachable`: Workers AI or Vectorize did not answer this time.
 * - `cap_reached`: the month's spend has reached the cap, and embedding stops there (section 5.7).
 */
export type WordsOnly = "missing" | "stale" | "unreachable" | "cap_reached";

/** What the screen says above a list answered from words alone. */
export function wordsOnlySaying(why: WordsOnly): string {
  switch (why) {
    case "missing":
      return "Found by words only: this Deployment has no index for search by meaning.";
    case "stale":
      return "Found by words only, while search by meaning is rebuilt from the Journal.";
    case "unreachable":
      return "Found by words only: search by meaning could not be reached just now.";
    case "cap_reached":
      return "Found by words only: this month's spend has reached the cap, and search by meaning stops there.";
  }
}

/**
 * What `rebuild_search_index` leaves: the Context's meaning index being built afresh from its
 * Journal, with how many Entries are still to be embedded. Not a record, and no Effect: the index
 * is derived, and rebuilding it changes nothing true.
 */
export type SearchIndex = { meaning: "building"; entries_to_embed: number };
