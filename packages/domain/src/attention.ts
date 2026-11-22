import { type Day, dayIn, daysBetween } from "./day.ts";
import { instantToIso } from "./entry.ts";
import { compare, inOrder, type Sorted } from "./in-order.ts";
import type { Project } from "./project.ts";
import type { Task, TaskEvent } from "./task.ts";

/**
 * How many days a Task that came up is listed in Newly actionable: the day it came up and the six
 * after. It is in code and is not a setting, and decides only how long a released Task is listed
 * apart (section 8.3).
 */
export const NEWLY_ACTIONABLE_DAYS = 7;

/**
 * Why an actionable Task came up, and when: a wait ended, as what it waited on reached an end or
 * the wait was stopped; it was taken back from the Person doing it; or its Defer Date came.
 */
export type CameUp =
  | { because: "wait_ended" | "taken_back"; at: string }
  | { because: "defer_date_came"; on: Day };

/** Something open that is Overdue or due today: a Task, or a Project as itself. */
export type DueItem = { kind: "task"; task: Task } | { kind: "project"; project: Project };

/** An open Project as Attention lists it, with its count of actionable Tasks. */
export type ProjectInAttention = {
  project: Project;
  /** How many of its Tasks are actionable, wherever else Attention shows them. */
  actionable_tasks: number;
  /** It has no open Task, so it needs a next Task or finishing. */
  no_open_task: boolean;
};

/**
 * What in a Context is open for the person to act on, in five sections in this order (section
 * 8.3). It holds Tasks and Projects only, derived by rule, and is the same for every caller.
 */
export type Attention = {
  /** Every open Task Overdue or due today, whatever else holds, and every open Project that is. */
  due: DueItem[];
  /** Actionable Tasks that came up in the last seven days, newest first. */
  newly_actionable: { task: Task; came_up: CameUp }[];
  /** Every other Delegated Task neither Waiting nor Deferred, oldest delegation first. */
  delegated: Task[];
  /** Every open Project, by name. */
  projects: ProjectInAttention[];
  /** Every other actionable Task with no Project, oldest first. */
  loose: Task[];
};

/** A Task with what has happened to it, oldest first, from which it came up. */
export type TaskWithEvents = { task: Task; events: TaskEvent[] };

/**
 * Attention from the open Tasks and open Projects of a Context, today in its time zone. A Task
 * appears once, in the first section it fits; a Project in Due is still in Projects.
 */
export function attention(
  openTasks: TaskWithEvents[],
  openProjects: Project[],
  today: Day,
  zone: string,
): Attention {
  const due: Sorted<DueItem>[] = [];
  const newly: Sorted<Attention["newly_actionable"][number]>[] = [];
  const delegated: Sorted<Task>[] = [];
  const loose: Sorted<Task>[] = [];
  for (const { task, events } of openTasks) {
    const state = task.state;
    if (state.is !== "open") continue;
    if (isDue(task.due_date, today)) {
      // Oldest Due Date first, and of one day, the one made first.
      due.push({ item: { kind: "task", task }, by: [task.due_date, task.at] });
    } else if (state.waiting !== null || state.deferred !== null) {
      // Not shown: it is reached through its Project, its Entry or search until it comes up.
    } else if (state.delegated !== null) {
      delegated.push({ item: task, by: [state.delegated.since] });
    } else {
      const came = cameUp(task, events, zone);
      if (came !== null && daysBetween(came.when.day, today) < NEWLY_ACTIONABLE_DAYS) {
        // Newest first.
        newly.push({ item: { task, came_up: came.came_up }, by: [came.when.day, came.when.at] });
      } else if (task.project === null) loose.push({ item: task, by: [task.at] });
    }
  }
  for (const project of openProjects) {
    if (isDue(project.due_date, today)) {
      due.push({ item: { kind: "project", project }, by: [project.due_date, project.at] });
    }
  }
  return {
    due: inOrder(due),
    newly_actionable: inOrder(newly).toReversed(),
    delegated: inOrder(delegated),
    projects: openProjects
      .toSorted((a, b) => byName.compare(a.name, b.name) || compare([a.at], [b.at]))
      .map((project) => ({
        project,
        actionable_tasks: project.tasks.filter(
          (task) => task.state.is === "open" && task.state.actionable,
        ).length,
        no_open_task: project.tasks.every((task) => task.state.is !== "open"),
      })),
    loose: inOrder(loose),
  };
}

/** Whether a Due Date has come: the day is today, or it has passed and the record is Overdue. */
function isDue(dueDate: Day | null, today: Day): dueDate is Day {
  return dueDate !== null && dueDate <= today;
}

/**
 * Projects by name, whatever the case and with numbers in the order they count. The same for every
 * caller, so in a locale fixed here rather than the Device's.
 */
const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * When something came up: the day, and the instant within it. A Defer Date comes at the start of
 * its day, before anything that happens on it.
 */
type When = { day: Day; at: number };

/**
 * When an actionable Task last came up, and why: the last of the things that kept it from being
 * actionable to end, since it was made or last reopened. A Defer Date counts only when it came
 * after that day, since a Task made or reopened on or after it was not Deferred then. Null when
 * nothing kept it back.
 */
function cameUp(
  task: Task,
  events: TaskEvent[],
  zone: string,
): { came_up: CameUp; when: When } | null {
  let last: { came_up: CameUp; when: When } | null = null;
  const consider = (came_up: CameUp, when: When) => {
    if (last === null || compare([when.day, when.at], [last.when.day, last.when.at]) > 0) {
      last = { came_up, when };
    }
  };
  // An open Task's last end, if it had one, was undone by its last reopening.
  const reopening = events.findLastIndex((event) => event.what === "reopened");
  for (const event of events.slice(reopening + 1)) {
    if (
      event.what === "released" ||
      event.what === "stopped_waiting" ||
      event.what === "taken_back"
    ) {
      consider(
        {
          because: event.what === "taken_back" ? "taken_back" : "wait_ended",
          at: instantToIso(event.at),
        },
        { day: dayIn(event.at, zone), at: event.at },
      );
    }
  }
  const since = events[reopening]?.at ?? Date.parse(task.at);
  const deferUntil = task.defer_date;
  if (deferUntil !== null && deferUntil > dayIn(since, zone)) {
    consider({ because: "defer_date_came", on: deferUntil }, { day: deferUntil, at: -Infinity });
  }
  return last;
}
