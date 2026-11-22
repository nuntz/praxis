import { addDays, type Day } from "./day.ts";
import { inOrder, type Sorted } from "./in-order.ts";
import type { Project } from "./project.ts";
import { occurrencesAhead } from "./recurrence.ts";
import type { Task } from "./task.ts";

/** How many days after today the weeks ahead cover unless asked for fewer or more. */
export const AHEAD_DAYS = 28;

/** The most days after today the weeks ahead can be asked to cover. */
export const MOST_AHEAD_DAYS = 90;

/**
 * An Occurrence a Recurrence has yet to make, worked out from the rule of the open one it would
 * follow. It does not exist until it is made, so it has no id and nothing can link to it or wait
 * on it (section 3.5). Each is worked out as if the one before it were closed on its Due Date.
 */
export type FutureOccurrence = {
  /** The id of the open Occurrence whose rule it is worked out from. */
  follows: string;
  title: string;
  /** The id of the Project it would be in, the open Occurrence's now, or null. */
  project: string | null;
  due_date: Day;
  defer_date: Day | null;
};

/** Which of its two dates, its Due Date or its Defer Date, something is listed on. */
export type AheadDate = "due_date" | "defer_date";

/** Of one day, Due Dates come before Defer Dates. */
const dateOrder: Record<AheadDate, number> = { due_date: 0, defer_date: 1 };

/**
 * One thing listed in the weeks ahead, on one of its days: an open Task on its Due Date or its
 * Defer Date, an open Project on its Due Date, or an Occurrence that does not exist yet on either.
 * A Task whose two days both fall in the weeks ahead is listed on each.
 */
export type AheadItem = { on: Day } & (
  | { which: AheadDate; kind: "task"; task: Task }
  | { which: "due_date"; kind: "project"; project: Project }
  | { which: AheadDate; kind: "future_occurrence"; occurrence: FutureOccurrence }
);

/**
 * What is coming in a Context in the days after today, `from` tomorrow to `to`, both included
 * (sections 3.5 and 4.10). Derived by rule, like Attention, and the same for every caller.
 */
export type Ahead = {
  from: Day;
  to: Day;
  /** By day; of one day, Due Dates before Defer Dates, then in the order made. */
  items: AheadItem[];
};

/**
 * The weeks ahead from the open Tasks and open Projects of a Context, today in its time zone,
 * over the `days` days after today. What is due today or Overdue is not ahead: it is in
 * Attention's Due section.
 */
export function ahead(openTasks: Task[], openProjects: Project[], today: Day, days: number): Ahead {
  const from = addDays(today, 1);
  const to = addDays(today, days);
  const within = (day: Day | null): day is Day => day !== null && day >= from && day <= to;
  const listed: Sorted<AheadItem>[] = [];
  /** Lists it on each of its dates that falls in these days, ordered then by when it was made. */
  const listOn = (
    dates: { due_date: Day | null; defer_date: Day | null },
    item: (on: Day, which: AheadDate) => AheadItem,
    ...made: string[]
  ) => {
    for (const which of ["due_date", "defer_date"] as const) {
      const on = dates[which];
      if (within(on)) listed.push({ item: item(on, which), by: [on, dateOrder[which], ...made] });
    }
  };
  for (const task of openTasks) {
    if (task.state.is !== "open") continue;
    listOn(task, (on, which) => ({ on, which, kind: "task", task }), task.at);
    if (task.recurrence === null || task.due_date === null) continue;
    const dates = { due_date: task.due_date, defer_date: task.defer_date };
    for (const next of occurrencesAhead(task.recurrence, dates, today, to)) {
      const occurrence = { follows: task.id, title: task.title, project: task.project, ...next };
      listOn(
        next,
        (on, which) => ({ on, which, kind: "future_occurrence", occurrence }),
        task.at,
        next.due_date,
      );
    }
  }
  for (const project of openProjects) {
    if (project.state.is !== "open") continue;
    // A Project has no Defer Date.
    listOn(
      { due_date: project.due_date, defer_date: null },
      (on) => ({ on, which: "due_date", kind: "project", project }),
      project.at,
    );
  }
  return { from, to, items: inOrder(listed) };
}
