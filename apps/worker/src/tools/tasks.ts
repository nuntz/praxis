import {
  authorOf,
  type Day,
  type End,
  failure,
  nameHolds,
  refusal,
  success,
  summarizeWords,
  type Task,
  type TaskEvent,
  type ToolResult,
  type Written,
  written,
} from "@praxis/domain";
import { authorColumns } from "../author.ts";
import { newestFirst } from "../newest-first.ts";
import { makeNextOccurrence } from "../occurrence-rows.ts";
import { readPerson } from "../person-rows.ts";
import type { Handlers, ToolCall } from "../registry.ts";
import {
  insertTask,
  insertTaskEvent,
  readTask,
  type TaskRow,
  taskEffect,
  tasksFrom,
} from "../task-rows.ts";
import { releaseWaitsOn } from "../wait-rows.ts";
import { NO_SUCH_PERSON } from "./persons.ts";

export const NO_SUCH_TASK = "No such Task in this Context.";

export const taskTools: Pick<
  Handlers,
  | "add_task"
  | "finish_task"
  | "drop_task"
  | "reopen_task"
  | "rename_task"
  | "set_task_dates"
  | "delegate_task"
  | "take_back_task"
  | "get_task"
  | "list_tasks"
> = {
  add_task({ caller, input, arrivedAt, today, sql }) {
    const entry = sql.exec(`SELECT 1 FROM entries WHERE id = ?`, input.entry_id).toArray();
    if (entry.length === 0) return failure("not_found", "No such Entry in this Context.");
    const id = insertTask(sql, {
      title: input.title,
      originEntry: input.entry_id,
      at: arrivedAt,
      author: authorOf(caller),
    });
    const task = readTask(sql, id, today) as Task;
    return success(written(task, [taskEffect(task, "made")]));
  },

  finish_task: (call) => reach("finished", call),

  drop_task: (call) => reach("dropped", call),

  reopen_task({ input, arrivedAt, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    if (task.state.is === "open") return success(written(task, []));
    return happened(sql, task, { what: "reopened", at: arrivedAt }, today);
  },

  rename_task({ caller, input, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    if (task.title === input.title) return success(written(task, []));
    // A record the person edits becomes theirs; anyone else's edit leaves its Author as it was.
    const author = caller.kind === "hand" ? authorOf(caller) : task.author;
    sql.exec(
      `UPDATE tasks SET title = ?, author_kind = ?, author_name = ? WHERE id = ?`,
      input.title,
      ...authorColumns(author),
      task.id,
    );
    const renamed = readTask(sql, task.id, today) as Task;
    return success(written(renamed, [taskEffect(renamed, "changed")]));
  },

  set_task_dates({ input, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    // A date left out stays as it was; null clears it. Setting dates is no edit of the Task's
    // words, so its Author stays as it was.
    const due = input.due_date === undefined ? task.due_date : input.due_date;
    const defer = input.defer_date === undefined ? task.defer_date : input.defer_date;
    if (due === task.due_date && defer === task.defer_date) return success(written(task, []));
    // What a Recurrence sets is the next Due Date, so a recurring Task keeps one.
    if (due === null && task.recurrence !== null) {
      return refusal(
        "A Task with a Recurrence must have a Due Date: remove its Recurrence first.",
        [{ kind: "task", id: task.id, summary: summarizeWords(task.title) }],
      );
    }
    sql.exec(`UPDATE tasks SET due_date = ?, defer_date = ? WHERE id = ?`, due, defer, task.id);
    const dated = readTask(sql, task.id, today) as Task;
    return success(written(dated, [taskEffect(dated, "changed")]));
  },

  delegate_task({ input, arrivedAt, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    const person = readPerson(sql, input.person_id);
    if (!person) return failure("not_found", NO_SUCH_PERSON);
    // Reaching an end ends a delegation, so a closed Task is reopened before it is handed on.
    if (task.state.is !== "open") return closedRefusal(task, task.state.is);
    if (task.state.delegated?.to.id === person.id) return success(written(task, []));
    const to = { id: person.id, name: person.name };
    return happened(sql, task, { what: "delegated", at: arrivedAt, to }, today);
  },

  take_back_task({ input, arrivedAt, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    if (task.state.is !== "open" || task.state.delegated === null) {
      return success(written(task, []));
    }
    return happened(sql, task, { what: "taken_back", at: arrivedAt }, today);
  },

  get_task({ input, today, sql }) {
    const task = readTask(sql, input.id, today);
    return task ? success(task) : failure("not_found", NO_SUCH_TASK);
  },

  list_tasks({ input, today, sql }) {
    const { named } = input;
    const page = newestFirst(
      "tasks",
      input.cursor,
      (before) => sql.exec<TaskRow>(`SELECT * FROM tasks WHERE seq < ? ORDER BY seq DESC`, before),
      named === undefined ? undefined : (row) => nameHolds(row.title, named),
    );
    if (!page.ok) return page;
    return success({
      items: tasksFrom(sql, page.value.rows, today),
      next_cursor: page.value.next_cursor,
    });
  },
};

/**
 * A Task reaches an end. At that end already, nothing changes. At the other end, it is refused:
 * the Task is reopened first, so going from one end to the other is never a single step.
 */
function reach(
  end: End,
  { input, arrivedAt, today, sql }: ToolCall<"finish_task" | "drop_task">,
): ToolResult<Written<Task>> {
  const task = readTask(sql, input.id, today);
  if (!task) return failure("not_found", NO_SUCH_TASK);
  if (task.state.is === end) return success(written(task, []));
  if (task.state.is !== "open") return closedRefusal(task, task.state.is);
  insertTaskEvent(sql, task.id, { what: end, at: arrivedAt });
  // A recurring Task's rule makes its next Occurrence, whichever end it reached.
  const next = makeNextOccurrence(sql, task, arrivedAt, today);
  // Its own waits end with it; each Task waiting on it is released, by rule.
  const released = releaseWaitsOn(sql, [{ kind: "task", id: task.id }], arrivedAt, today);
  const closed = readTask(sql, task.id, today) as Task;
  return success(
    written(closed, [
      taskEffect(closed, "changed"),
      ...(next ? [taskEffect(next, "made", "rule")] : []),
      ...released.map((waiter) => taskEffect(waiter, "changed", "rule")),
    ]),
  );
}

/** An end as the glossary writes it. */
export function endWord(end: End): "Finished" | "Dropped" {
  return end === "finished" ? "Finished" : "Dropped";
}

/** A Task at an end is refused what only an open Task takes, and is named in the way. */
export function closedRefusal(task: Task, end: End): ToolResult<never> {
  return refusal(`The Task is ${endWord(end)}: reopen it first.`, [
    { kind: "task", id: task.id, summary: summarizeWords(task.title) },
  ]);
}

/** Something happened to a Task: its state follows, and the Task is the call's one Effect. */
export function happened(
  sql: SqlStorage,
  task: Task,
  event: TaskEvent,
  today: Day,
): ToolResult<Written<Task>> {
  insertTaskEvent(sql, task.id, event);
  const updated = readTask(sql, task.id, today) as Task;
  return success(written(updated, [taskEffect(updated, "changed")]));
}
