import type { Author } from "./callers.ts";
import { instantToIso } from "./entry.ts";

/** A Task as every read and write returns it (section 3.3). It has a title and no body. */
export type Task = {
  id: string;
  title: string;
  /** The id of the Entry it came from. Every Task has one. */
  origin_entry: string;
  /** When it was made, as an ISO 8601 instant. */
  at: string;
  author: Author;
  /** Derived from what has happened to it, with the reason; never set (section 3.4). */
  state: TaskState;
};

/** The two ends a Task can reach. */
export type End = "finished" | "dropped";

/** A Task is open, or at one of its ends since a time. */
export type TaskState = { is: "open" } | { is: End; at: string };

/** One thing that happened to a Task, at an instant held as milliseconds since the epoch. */
export type TaskEvent = { what: End | "reopened"; at: number };

/**
 * A Task's state from its events, oldest first: the last end it reached and when, unless it was
 * reopened since. A Task nothing has happened to is open.
 */
export function taskState(events: TaskEvent[]): TaskState {
  const last = events.at(-1);
  if (!last || last.what === "reopened") return { is: "open" };
  return { is: last.what, at: instantToIso(last.at) };
}

/** A Task to make with an Entry, as `record_entry` takes it (section 4.8). */
export type NewTask = { title: string };

/** `[]`, `[ ]` or `- [ ]` at the very start of a line, and the rest of the line after it. */
const INLINE_TASK = /^(?:\[\]|\[ \]|- \[ \])(.*)$/;

/**
 * The Inline Tasks in what the person typed, in the order typed (section 3.2). The editor passes
 * them to `record_entry` with the words, which keep the markers: the server never reads words to
 * find Tasks. A list item alone (`- `) makes no Task, and nor does a marker with no title.
 */
export function inlineTasks(words: string): NewTask[] {
  return words.split(/\r\n|\r|\n/).flatMap((line) => {
    const title = INLINE_TASK.exec(line)?.[1]?.trim();
    return title ? [{ title }] : [];
  });
}
