import {
  type Author,
  type Day,
  type Effect,
  instantToIso,
  summarizeWords,
  type Task,
  type TaskEvent,
  taskState,
} from "@praxis/domain";
import { type AuthorColumns, authorColumns, toAuthor } from "./author.ts";

export type TaskRow = AuthorColumns & {
  seq: number;
  id: string;
  title: string;
  origin_entry: string;
  at: number;
  project: string | null;
  due_date: string | null;
  defer_date: string | null;
};

type EventRow = { task: string; what: TaskEvent["what"]; at: number };

/** Make a Task on an Entry that exists, and return its id. */
export function insertTask(
  sql: SqlStorage,
  task: { title: string; originEntry: string; at: number; author: Author },
): string {
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO tasks (id, title, origin_entry, at, author_kind, author_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    task.title,
    task.originEntry,
    task.at,
    ...authorColumns(task.author),
  );
  return id;
}

/** Put a Task in a Project, or in none. Its place in a Project is the Task's own. */
export function setTaskProject(sql: SqlStorage, task: string, project: string | null): void {
  sql.exec(`UPDATE tasks SET project = ? WHERE id = ?`, project, task);
}

/** Add one thing that happened to a Task. Its state follows from these. */
export function insertTaskEvent(sql: SqlStorage, task: string, event: TaskEvent): void {
  sql.exec(`INSERT INTO task_events (task, what, at) VALUES (?, ?, ?)`, task, event.what, event.at);
}

/** A Task that exists in this Context, its state read as on `today`. */
export function readTask(sql: SqlStorage, id: string, today: Day): Task | null {
  const row = sql.exec<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, id).toArray()[0];
  if (!row) return null;
  const events = sql
    .exec<EventRow>(`SELECT task, what, at FROM task_events WHERE task = ? ORDER BY seq`, id)
    .toArray();
  return toTask(row, events, today);
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
      `SELECT * FROM tasks WHERE ${column} IN (SELECT value FROM json_each(?)) ORDER BY seq`,
      JSON.stringify(ids),
    )
    .toArray();
  return Map.groupBy(tasksFrom(sql, rows, today), key);
}

/** These Tasks, in the order given, each with its state read as on `today`. */
export function tasksFrom(sql: SqlStorage, rows: TaskRow[], today: Day): Task[] {
  const events = Map.groupBy(
    sql
      .exec<EventRow>(
        `SELECT task, what, at FROM task_events
         WHERE task IN (SELECT value FROM json_each(?)) ORDER BY seq`,
        JSON.stringify(rows.map((row) => row.id)),
      )
      .toArray(),
    (event) => event.task,
  );
  return rows.map((row) => toTask(row, events.get(row.id) ?? [], today));
}

/** The Effect of a change to a Task, by the call or a rule, with its one-line summary. */
export function taskEffect(task: Task, what: Effect["what"], by: Effect["by"] = "call"): Effect {
  return { kind: "task", id: task.id, what, summary: summarizeWords(task.title), by };
}

function toTask(row: TaskRow, events: EventRow[], today: Day): Task {
  const dates = { due_date: row.due_date, defer_date: row.defer_date };
  return {
    id: row.id,
    title: row.title,
    origin_entry: row.origin_entry,
    at: instantToIso(row.at),
    author: toAuthor(row),
    project: row.project,
    ...dates,
    state: taskState(events, dates, today),
  };
}
