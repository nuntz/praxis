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

/** One ranked list of what a search found, best first, a page at a time. */
export type SearchResults = Page<SearchHit>;
