import { addDays, type Day } from "./day.ts";
import { instantToIso } from "./entry.ts";
import type { End, Task } from "./task.ts";

/**
 * A Project as every read and write returns it (section 3.6): a name, an optional Due Date, and
 * the Tasks in it. It has no description: what there is to say is said in Entries.
 */
export type Project = {
  id: string;
  name: string;
  /** When it was made, as an ISO 8601 instant. */
  at: string;
  /** The day it should be Finished by. It says nothing about its Tasks' Due Dates. */
  due_date: Day | null;
  /** Derived from what was declared of it, its Due Date and today. */
  state: ProjectState;
  /** The Tasks in it, open or closed, in the order they were made. */
  tasks: Task[];
};

/**
 * A Project is open, or at one of its ends since a time. An open one can be Overdue. It reaches
 * an end only when declared, never because its Tasks ran out.
 */
export type ProjectState =
  | {
      is: "open";
      /** Its Due Date has passed: the day it became Overdue, the one after its Due Date. */
      overdue: { since: Day } | null;
    }
  | { is: End; at: string };

/** What was declared of a Project, at an instant held as milliseconds since the epoch. */
export type ProjectEvent = { what: End | "reopened"; at: number };

/**
 * A Project's state from what was declared of it, oldest first, its Due Date and today in its
 * Context's time zone: the last end declared and when, unless it was reopened since.
 */
export function projectState(
  events: ProjectEvent[],
  dueDate: Day | null,
  today: Day,
): ProjectState {
  const last = events.at(-1);
  if (last && last.what !== "reopened") return { is: last.what, at: instantToIso(last.at) };
  return {
    is: "open",
    overdue: dueDate !== null && dueDate < today ? { since: addDays(dueDate, 1) } : null,
  };
}
