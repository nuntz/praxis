import type { ProjectInAttention } from "./attention.ts";
import type { Author } from "./callers.ts";
import type { Page } from "./entry.ts";
import type { Project } from "./project.ts";
import type { Task } from "./task.ts";

/** A span of an excerpt, in UTF-16 code units as JavaScript counts a string, end not included. */
export type Span = { start: number; end: number };

/**
 * The part of a record's words, title or name that a search found, as plain text on one line,
 * with the spans of the words that matched, a short word's only beside a longer word's (section
 * 9.4). It is never rendered as Markdown (section 8.4): an Entry's excerpt is cut from its words
 * and may end inside a link or an emphasis.
 */
export type Excerpt = { text: string; matches: Span[] };

/**
 * One record a search found (section 9.4): its kind and id, its one-line summary as reads give
 * it, when it was made, and the excerpt. An Entry and a Task carry their Author, and a Task the
 * Entry it hangs off. A Task and a Project carry where they stand, so a caller needs no read per
 * hit to know whether it is still open: a Task its dates, Recurrence and state as `get_task` gives
 * them, a Project its Due Date and state as `get_project` gives them, with its count of actionable
 * Tasks and its no-open-Task flag as `view_attention` gives them. A Person has no state. Read the
 * record itself by its id.
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
  | ({
      kind: "task";
      id: string;
      summary: string;
      at: string;
      author: Author;
      origin_entry: string;
      excerpt: Excerpt;
    } & TaskStanding)
  | ({ kind: "project"; id: string; summary: string; at: string; excerpt: Excerpt } & Pick<
      Project,
      "due_date" | "state"
    > &
      Omit<ProjectInAttention, "project">)
  | { kind: "person"; id: string; summary: string; at: string; excerpt: Excerpt };

/** Where a Task stands, as `get_task` gives it: its dates, its Recurrence and its state. */
type TaskStanding = Pick<Task, "due_date" | "defer_date" | "recurrence" | "state">;

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

/** Whether a search was given words: not none, and not only spaces. */
export function hasWords(input: { words?: string | undefined }): boolean {
  return (input.words?.trim() ?? "") !== "";
}

/**
 * Whether a search is narrowed, by a range of days, a Project, a Person or an Author, any one or
 * more: then it lists with no words, everything the narrowing holds (section 9.4).
 */
export function narrowsSearch(input: {
  from?: string | undefined;
  to?: string | undefined;
  project_id?: string | undefined;
  person_id?: string | undefined;
  author?: object | undefined;
}): boolean {
  return [input.from, input.to, input.project_id, input.person_id, input.author].some(
    (narrowing) => narrowing !== undefined,
  );
}
