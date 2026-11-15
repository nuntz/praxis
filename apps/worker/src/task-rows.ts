import {
  type Author,
  type Effect,
  instantToIso,
  summarizeWords,
  type Task,
  type TaskEvent,
  taskState,
} from "@praxis/domain";
import { type AuthorColumns, authorColumns, toAuthor } from "./author.ts";

type TaskRow = AuthorColumns & {
  seq: number;
  id: string;
  title: string;
  origin_entry: string;
  at: number;
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

/** Add one thing that happened to a Task. Its state follows from these. */
export function insertTaskEvent(sql: SqlStorage, task: string, event: TaskEvent): void {
  sql.exec(`INSERT INTO task_events (task, what, at) VALUES (?, ?, ?)`, task, event.what, event.at);
}

export function readTask(sql: SqlStorage, id: string): Task | null {
  const row = sql.exec<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, id).toArray()[0];
  if (!row) return null;
  const events = sql
    .exec<EventRow>(`SELECT task, what, at FROM task_events WHERE task = ? ORDER BY seq`, id)
    .toArray();
  return toTask(row, events);
}

/** The Tasks of each of these Entries, in the order they were made, by Entry id. */
export function tasksOf(sql: SqlStorage, entries: string[]): Map<string, Task[]> {
  const ids = JSON.stringify(entries);
  const rows = sql
    .exec<TaskRow>(
      `SELECT * FROM tasks WHERE origin_entry IN (SELECT value FROM json_each(?)) ORDER BY seq`,
      ids,
    )
    .toArray();
  const events = Map.groupBy(
    sql
      .exec<EventRow>(
        `SELECT e.task, e.what, e.at FROM task_events e JOIN tasks t ON t.id = e.task
         WHERE t.origin_entry IN (SELECT value FROM json_each(?)) ORDER BY e.seq`,
        ids,
      )
      .toArray(),
    (event) => event.task,
  );
  return Map.groupBy(
    rows.map((row) => toTask(row, events.get(row.id) ?? [])),
    (task) => task.origin_entry,
  );
}

/** The Effect of a call on a Task, with its one-line summary. */
export function taskEffect(task: Task, what: Effect["what"]): Effect {
  return { kind: "task", id: task.id, what, summary: summarizeWords(task.title), by: "call" };
}

function toTask(row: TaskRow, events: EventRow[]): Task {
  return {
    id: row.id,
    title: row.title,
    origin_entry: row.origin_entry,
    at: instantToIso(row.at),
    author: toAuthor(row),
    state: taskState(events),
  };
}
