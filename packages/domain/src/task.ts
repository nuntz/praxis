import type { Author } from "./callers.ts";
import { addDays, type Day } from "./day.ts";
import { instantToIso } from "./entry.ts";
import type { Person } from "./person.ts";

/** A Person as a Task names them: their id, and their name as it is now. */
type PersonNamed = Pick<Person, "id" | "name">;

/** What a Task can wait on: a Task or Project in its own Context, never a Person. */
export type WaitTarget = { kind: "task" | "project"; id: string };

/** What a Task waits on, named as it is now: a Task by its title, a Project by its name. */
export type WaitedOn =
  | { kind: "task"; id: string; title: string }
  | { kind: "project"; id: string; name: string };

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
  /**
   * It waits on Tasks or Projects that are still open: each, and since when as an ISO 8601
   * instant, in the order waited on.
   */
  waiting: { on: WaitedOn; since: string }[] | null;
  /** A Person is doing it: who, and since when as an ISO 8601 instant. */
  delegated: { to: PersonNamed; since: string } | null;
  /** Its Defer Date has not come: the day it is Deferred until. */
  deferred: { until: Day } | null;
  /** Its Due Date has passed: the day it became Overdue, the one after its Due Date. */
  overdue: { since: Day } | null;
};

/** A Task is open, or at one of its ends since a time. */
export type TaskState = OpenState | { is: End; at: string };

/**
 * One thing that happened to a Task, at an instant held as milliseconds since the epoch: it
 * reached an end or was reopened, it was Delegated to a Person or taken back, or it started
 * waiting on a Task or Project and stopped, or was released when that one reached an end.
 */
export type TaskEvent =
  | { what: End | "reopened" | "taken_back"; at: number }
  | { what: "delegated"; at: number; to: PersonNamed }
  | { what: "waited_on"; at: number; on: WaitedOn }
  | { what: "stopped_waiting" | "released"; at: number; on: WaitTarget };

/**
 * A Task's state from its events, oldest first, its dates and today in its Context's time zone.
 * It is the last end it reached and when, unless it was reopened since. A Task nothing has
 * happened to is open. It is Delegated to the last Person it was handed to, until it is taken
 * back or reaches an end; reopening does not bring the delegation back. It waits on each Task or
 * Project it was set waiting on, until it stops, is released by that one's end, or reaches an end
 * itself; reopening brings back no wait. Only an open Task is Waiting, Delegated, Deferred or
 * Overdue.
 */
export function taskState(events: TaskEvent[], dates: TaskDates, today: Day): TaskState {
  let end: { is: End; at: string } | null = null;
  let delegated: OpenState["delegated"] = null;
  const waits = new Map<string, { on: WaitedOn; since: string }>();
  for (const event of events) {
    if (event.what === "delegated") delegated = { to: event.to, since: instantToIso(event.at) };
    else if (event.what === "taken_back") delegated = null;
    else if (event.what === "waited_on") {
      waits.set(waitKey(event.on), { on: event.on, since: instantToIso(event.at) });
    } else if (event.what === "stopped_waiting" || event.what === "released") {
      waits.delete(waitKey(event.on));
    } else if (event.what === "reopened") end = null;
    else {
      end = { is: event.what, at: instantToIso(event.at) };
      delegated = null;
      waits.clear();
    }
  }
  if (end) return end;
  const deferred = dates.defer_date !== null && dates.defer_date > today;
  const overdue = dates.due_date !== null && dates.due_date < today;
  const waiting = waits.size > 0 ? [...waits.values()] : null;
  return {
    is: "open",
    actionable: !deferred && delegated === null && waiting === null,
    waiting,
    delegated,
    deferred: deferred ? { until: dates.defer_date as Day } : null,
    overdue: overdue ? { since: addDays(dates.due_date as Day, 1) } : null,
  };
}

/** One key for a Task or Project waited on, whichever kind it is, so two can be compared. */
export function waitKey({ kind, id }: WaitTarget): string {
  return `${kind}:${id}`;
}

/** The title of a Task waited on, or the name of a Project. */
export function waitedOnName(on: WaitedOn): string {
  return on.kind === "task" ? on.title : on.name;
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
