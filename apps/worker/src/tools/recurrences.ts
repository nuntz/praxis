import {
  failure,
  type NewRecurrence,
  type Recurrence,
  refusal,
  success,
  summarizeWords,
  type Task,
  written,
} from "@praxis/domain";
import type { Handlers } from "../registry.ts";
import { readTask, setRecurrence, taskEffect } from "../task-rows.ts";
import { closedRefusal, NO_SUCH_TASK } from "./tasks.ts";

export const recurrenceTools: Pick<Handlers, "set_recurrence" | "remove_recurrence"> = {
  set_recurrence({ input, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    // Only the open Occurrence holds the rule: a closed Task has moved it on, or never had one.
    if (task.state.is !== "open") return closedRefusal(task, task.state.is);
    // What the rule sets is the next Due Date, so it needs one to step from.
    if (task.due_date === null) {
      return refusal("A Task with a Recurrence must have a Due Date: set one first.", [
        { kind: "task", id: task.id, summary: summarizeWords(task.title) },
      ]);
    }
    // A schedule counts from the Due Date it is set on, so moving one Occurrence's Due Date
    // later moves that Occurrence only. The rule it has keeps the day it counts from.
    const rule = input.recurrence;
    if (task.recurrence && sameRule(task.recurrence, rule)) return success(written(task, []));
    setRecurrence(sql, task.id, rule.kind === "interval" ? rule : { ...rule, from: task.due_date });
    const recurring = readTask(sql, task.id, today) as Task;
    return success(written(recurring, [taskEffect(recurring, "changed")]));
  },

  remove_recurrence({ input, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    if (task.recurrence === null) return success(written(task, []));
    setRecurrence(sql, task.id, null);
    const plain = readTask(sql, task.id, today) as Task;
    return success(written(plain, [taskEffect(plain, "changed")]));
  },
};

/** Whether a Task's Recurrence is this rule, whatever day its schedule counts from. */
function sameRule(held: Recurrence, rule: NewRecurrence): boolean {
  const { from: _, ...asGiven } = { from: null, ...held };
  return canonical(asGiven) === canonical(rule);
}

/** An object's fields as text, whatever order they came in. */
function canonical(fields: object): string {
  return JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
}
