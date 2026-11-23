import {
  type Author,
  type Day,
  type Effect,
  instantToIso,
  type Recurrence,
  summarizeWords,
  type Task,
  type TaskDates,
  type TaskEvent,
  type TaskWithEvents,
  taskState,
  type WaitedOn,
  type WaitTarget,
} from "@praxis/domain";
import { type AuthorColumns, authorColumns, toAuthor } from "./author.ts";
import { untrashedById } from "./record-tables.ts";

export type TaskRow = AuthorColumns & {
  seq: number;
  id: string;
  title: string;
  origin_entry: string;
  at: number;
  project: string | null;
  due_date: string | null;
  defer_date: string | null;
  recurrence: string | null;
};

type EventRow = {
  task: string;
  what: TaskEvent["what"];
  at: number;
  person: string | null;
  person_name: string | null;
  on_kind: WaitTarget["kind"] | null;
  on_id: string | null;
  on_name: string | null;
};

/**
 * A Task's events with the Person each delegation names and the Task or Project each wait names,
 * as they are now called.
 */
const EVENTS = `SELECT e.task, e.what, e.at, e.person, p.name AS person_name,
    e.on_kind, e.on_id, coalesce(t.title, pr.name) AS on_name
  FROM task_events e
  LEFT JOIN persons p ON p.id = e.person
  LEFT JOIN tasks t ON e.on_kind = 'task' AND t.id = e.on_id
  LEFT JOIN projects pr ON e.on_kind = 'project' AND pr.id = e.on_id`;

/**
 * Make a Task on an Entry that exists, and return its id. A new Task is in no Project, has no
 * dates and no Recurrence, unless it is an Occurrence carrying them on.
 */
export function insertTask(
  sql: SqlStorage,
  task: {
    title: string;
    originEntry: string;
    at: number;
    author: Author;
    project?: string | null;
    dates?: TaskDates;
    recurrence?: Recurrence | null;
  },
): string {
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO tasks
       (id, title, origin_entry, at, author_kind, author_name, project, due_date, defer_date,
        recurrence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    task.title,
    task.originEntry,
    task.at,
    ...authorColumns(task.author),
    task.project ?? null,
    task.dates?.due_date ?? null,
    task.dates?.defer_date ?? null,
    task.recurrence ? JSON.stringify(task.recurrence) : null,
  );
  return id;
}

/** Put a Task in a Project, or in none. Its place in a Project is the Task's own. */
export function setTaskProject(sql: SqlStorage, task: string, project: string | null): void {
  sql.exec(`UPDATE tasks SET project = ? WHERE id = ?`, project, task);
}

/** Put a Recurrence on a Task, or take it off with null. */
export function setRecurrence(sql: SqlStorage, task: string, recurrence: Recurrence | null): void {
  sql.exec(
    `UPDATE tasks SET recurrence = ? WHERE id = ?`,
    recurrence === null ? null : JSON.stringify(recurrence),
    task,
  );
}

/** Add one thing that happened to a Task. Its state follows from these. */
export function insertTaskEvent(sql: SqlStorage, task: string, event: TaskEvent): void {
  const on = "on" in event ? event.on : null;
  sql.exec(
    `INSERT INTO task_events (task, what, at, person, on_kind, on_id) VALUES (?, ?, ?, ?, ?, ?)`,
    task,
    event.what,
    event.at,
    event.what === "delegated" ? event.to.id : null,
    on?.kind ?? null,
    on?.id ?? null,
  );
}

/** A Task that exists in this Context, its state read as on `today`. */
export function readTask(sql: SqlStorage, id: string, today: Day): Task | null {
  const row = sql.exec<TaskRow>(`SELECT * FROM untrashed_tasks WHERE id = ?`, id).toArray()[0];
  if (!row) return null;
  const events = sql.exec<EventRow>(`${EVENTS} WHERE e.task = ? ORDER BY e.seq`, id).toArray();
  return toTask(row, events.map(toEvent), today);
}

/** The Tasks with these ids that exist in this Context, by id, read as on `today`. */
export function readTasks(sql: SqlStorage, ids: string[], today: Day): Map<string, Task> {
  return untrashedById(sql, "task", ids, (rows: TaskRow[]) => tasksFrom(sql, rows, today));
}

/** The Tasks of each of these Entries, in the order they were made, by Entry id. */
export function tasksOf(sql: SqlStorage, entries: string[], today: Day): Map<string, Task[]> {
  return tasksBy(sql, "origin_entry", entries, today, (task) => task.origin_entry);
}

/** The Tasks in each of these Projects, in the order they were made, by Project id. */
export function tasksIn(sql: SqlStorage, projects: string[], today: Day): Map<string, Task[]> {
  return tasksBy(sql, "project", projects, today, (task) => task.project ?? "");
}

/** The Tasks whose Origin Entry or Project is one of these ids, grouped by `key`. */
function tasksBy(
  sql: SqlStorage,
  column: "origin_entry" | "project",
  ids: string[],
  today: Day,
  key: (task: Task) => string,
): Map<string, Task[]> {
  const rows = sql
    .exec<TaskRow>(
      `SELECT * FROM untrashed_tasks WHERE ${column} IN (SELECT value FROM json_each(?)) ORDER BY seq`,
      JSON.stringify(ids),
    )
    .toArray();
  return Map.groupBy(tasksFrom(sql, rows, today), key);
}

/** These Tasks, in the order given, each with its state read as on `today`. */
export function tasksFrom(sql: SqlStorage, rows: TaskRow[], today: Day): Task[] {
  return withEvents(sql, rows, today).map(({ task }) => task);
}

/**
 * The open Tasks in this Context, in the order they were made, each with its state read as on
 * `today` and what has happened to it, oldest first.
 */
export function openTasks(sql: SqlStorage, today: Day): TaskWithEvents[] {
  // Open is derived: a Task is open unless the last end it reached was not reopened since.
  const rows = sql
    .exec<TaskRow>(
      `SELECT t.* FROM untrashed_tasks t
       WHERE coalesce((SELECT what FROM task_events e
                       WHERE e.task = t.id AND e.what IN ('finished', 'dropped', 'reopened')
                       ORDER BY e.seq DESC LIMIT 1), 'reopened') = 'reopened'
       ORDER BY t.seq`,
    )
    .toArray();
  return withEvents(sql, rows, today);
}

function withEvents(sql: SqlStorage, rows: TaskRow[], today: Day): TaskWithEvents[] {
  const events = Map.groupBy(
    sql
      .exec<EventRow>(
        `${EVENTS} WHERE e.task IN (SELECT value FROM json_each(?)) ORDER BY e.seq`,
        JSON.stringify(rows.map((row) => row.id)),
      )
      .toArray(),
    (event) => event.task,
  );
  return rows.map((row) => {
    const happened = (events.get(row.id) ?? []).map(toEvent);
    return { task: toTask(row, happened, today), events: happened };
  });
}

/** The Effect of a change to a Task, by the call or a rule, with its one-line summary. */
export function taskEffect(task: Task, what: Effect["what"], by: Effect["by"] = "call"): Effect {
  return { kind: "task", id: task.id, what, summary: summarizeWords(task.title), by };
}

function toTask(row: TaskRow, events: TaskEvent[], today: Day): Task {
  const dates = { due_date: row.due_date, defer_date: row.defer_date };
  return {
    id: row.id,
    title: row.title,
    origin_entry: row.origin_entry,
    at: instantToIso(row.at),
    author: toAuthor(row),
    project: row.project,
    ...dates,
    recurrence: row.recurrence === null ? null : (JSON.parse(row.recurrence) as Recurrence),
    state: taskState(events, dates, today),
  };
}

function toEvent(row: EventRow): TaskEvent {
  const { what, at } = row;
  switch (what) {
    case "delegated":
      return { what, at, to: { id: row.person as string, name: row.person_name as string } };
    case "waited_on": {
      const [id, named] = [row.on_id as string, row.on_name as string];
      const on: WaitedOn =
        row.on_kind === "task"
          ? { kind: "task", id, title: named }
          : { kind: "project", id, name: named };
      return { what, at, on };
    }
    case "stopped_waiting":
    case "released":
      return { what, at, on: { kind: row.on_kind as WaitTarget["kind"], id: row.on_id as string } };
    default:
      return { what, at };
  }
}
