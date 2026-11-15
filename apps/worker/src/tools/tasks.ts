import {
  authorOf,
  type End,
  failure,
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
import type { Handlers, ToolCall } from "../registry.ts";
import { insertTask, insertTaskEvent, readTask, taskEffect } from "../task-rows.ts";

const NO_SUCH_TASK = "No such Task in this Context.";

export const taskTools: Pick<
  Handlers,
  "add_task" | "finish_task" | "drop_task" | "reopen_task" | "rename_task" | "get_task"
> = {
  add_task({ caller, input, arrivedAt, sql }) {
    const entry = sql.exec(`SELECT 1 FROM entries WHERE id = ?`, input.entry_id).toArray();
    if (entry.length === 0) return failure("not_found", "No such Entry in this Context.");
    const id = insertTask(sql, {
      title: input.title,
      originEntry: input.entry_id,
      at: arrivedAt,
      author: authorOf(caller),
    });
    const task = readTask(sql, id) as Task;
    return success(written(task, [taskEffect(task, "made")]));
  },

  finish_task: (call) => reach("finished", call),

  drop_task: (call) => reach("dropped", call),

  reopen_task({ input, arrivedAt, sql }) {
    const task = readTask(sql, input.id);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    if (task.state.is === "open") return success(written(task, []));
    return happened(sql, task, { what: "reopened", at: arrivedAt });
  },

  rename_task({ caller, input, sql }) {
    const task = readTask(sql, input.id);
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
    const renamed = readTask(sql, task.id) as Task;
    return success(written(renamed, [taskEffect(renamed, "changed")]));
  },

  get_task({ input, sql }) {
    const task = readTask(sql, input.id);
    return task ? success(task) : failure("not_found", NO_SUCH_TASK);
  },
};

/**
 * A Task reaches an end. At that end already, nothing changes. At the other end, it is refused:
 * the Task is reopened first, so going from one end to the other is never a single step.
 */
function reach(
  end: End,
  { input, arrivedAt, sql }: ToolCall<"finish_task" | "drop_task">,
): ToolResult<Written<Task>> {
  const task = readTask(sql, input.id);
  if (!task) return failure("not_found", NO_SUCH_TASK);
  if (task.state.is === end) return success(written(task, []));
  if (task.state.is !== "open") {
    const at = task.state.is === "finished" ? "Finished" : "Dropped";
    return refusal(`The Task is ${at}: reopen it first.`, [
      { kind: "task", id: task.id, summary: summarizeWords(task.title) },
    ]);
  }
  return happened(sql, task, { what: end, at: arrivedAt });
}

/** Something happened to a Task: its state follows, and the Task is the call's one Effect. */
function happened(sql: SqlStorage, task: Task, event: TaskEvent): ToolResult<Written<Task>> {
  insertTaskEvent(sql, task.id, event);
  const updated = readTask(sql, task.id) as Task;
  return success(written(updated, [taskEffect(updated, "changed")]));
}
