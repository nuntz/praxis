import type { Author } from "./callers.ts";
import { addDays, type Day } from "./day.ts";
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
  /** The id of the Project it is in, or null. A Project is the only thing that contains Tasks. */
  project: string | null;
  due_date: TaskDates["due_date"];
  defer_date: TaskDates["defer_date"];
  /** Derived from what has happened to it, its dates and today, with the reason (section 3.4). */
  state: TaskState;
};

/** A Task's two days, each optional. Neither has a time of day. */
export type TaskDates = {
  /** The day it should be Finished by. */
  due_date: Day | null;
  /** The day it is put off until. */
  defer_date: Day | null;
};

/** The two ends a Task can reach. */
export type End = "finished" | "dropped";

/**
 * An open Task, with each state that holds for it and the reason. There is no leading state:
 * any of them can hold at once.
 */
export type OpenState = {
  is: "open";
  /** None of Waiting, Delegated or Deferred: the person could act on it now. */
  actionable: boolean;
  /** Its Defer Date has not come: the day it is Deferred until. */
  deferred: { until: Day } | null;
  /** Its Due Date has passed: the day it became Overdue, the one after its Due Date. */
  overdue: { since: Day } | null;
};

/** A Task is open, or at one of its ends since a time. */
export type TaskState = OpenState | { is: End; at: string };

/** One thing that happened to a Task, at an instant held as milliseconds since the epoch. */
export type TaskEvent = { what: End | "reopened"; at: number };

/**
 * A Task's state from its events, oldest first, its dates and today in its Context's time zone.
 * It is the last end it reached and when, unless it was reopened since. A Task nothing has
 * happened to is open. Only an open Task is Deferred or Overdue.
 */
export function taskState(events: TaskEvent[], dates: TaskDates, today: Day): TaskState {
  const last = events.at(-1);
  if (last && last.what !== "reopened") return { is: last.what, at: instantToIso(last.at) };
  const deferred = dates.defer_date !== null && dates.defer_date > today;
  const overdue = dates.due_date !== null && dates.due_date < today;
  return {
    is: "open",
    actionable: !deferred,
    deferred: deferred ? { until: dates.defer_date as Day } : null,
    overdue: overdue ? { since: addDays(dates.due_date as Day, 1) } : null,
  };
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
