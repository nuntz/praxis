import {
  type Day,
  type End,
  failure,
  refusal,
  success,
  summarizeWords,
  type Task,
  type WaitedOn,
  type WaitTarget,
  waitedOnName,
  waitKey,
  written,
} from "@praxis/domain";
import { readProject } from "../project-rows.ts";
import type { Handlers } from "../registry.ts";
import { readTask, type TaskRow, tasksFrom } from "../task-rows.ts";
import { NO_SUCH_PROJECT } from "./projects.ts";
import { closedRefusal, endWord, happened, NO_SUCH_TASK } from "./tasks.ts";

export const waitTools: Pick<Handlers, "wait_on" | "stop_waiting"> = {
  wait_on({ input, arrivedAt, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    const target = findWaitTarget(sql, input.on, today);
    if (!target) return failure("not_found", NOT_HERE[input.on.kind]);
    // Reaching an end ends a Task's waits, so a closed Task is reopened before it waits again.
    if (task.state.is !== "open") return closedRefusal(task, task.state.is);
    const { on, end } = target;
    if (waitsOn(task, on)) return success(written(task, []));
    // A wait ends when what it waits on reaches an end, so there is nothing closed to wait on.
    if (end) {
      const what = on.kind === "task" ? "Task" : "Project";
      return refusal(
        `The ${what} to wait on is ${endWord(end)}: there is nothing left to wait for.`,
        [{ kind: on.kind, id: on.id, summary: summarizeWords(waitedOnName(on)) }],
      );
    }
    const cycle = on.kind === "task" ? waitPath(sql, on.id, task.id, today) : null;
    if (cycle) {
      return refusal(
        "The wait would make a cycle: each Task listed waits, in turn, on the next and the last on this one.",
        cycle.map((link) => ({ kind: "task", id: link.id, summary: summarizeWords(link.title) })),
      );
    }
    return happened(sql, task, { what: "waited_on", at: arrivedAt, on }, today);
  },

  stop_waiting({ input, arrivedAt, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    if (!findWaitTarget(sql, input.on, today)) return failure("not_found", NOT_HERE[input.on.kind]);
    if (!waitsOn(task, input.on)) return success(written(task, []));
    const on = { kind: input.on.kind, id: input.on.id };
    return happened(sql, task, { what: "stopped_waiting", at: arrivedAt, on }, today);
  },
};

const NOT_HERE: Record<WaitTarget["kind"], string> = {
  task: NO_SUCH_TASK,
  project: NO_SUCH_PROJECT,
};

/**
 * The Task or Project a wait names, as it is now, and the end it is at if it is closed. Null if
 * it is not in this Context.
 */
function findWaitTarget(
  sql: SqlStorage,
  target: WaitTarget,
  today: Day,
): { on: WaitedOn; end: End | null } | null {
  const found =
    target.kind === "task" ? readTask(sql, target.id, today) : readProject(sql, target.id, today);
  if (!found) return null;
  const end = found.state.is === "open" ? null : found.state.is;
  const on: WaitedOn =
    "title" in found
      ? { kind: "task", id: found.id, title: found.title }
      : { kind: "project", id: found.id, name: found.name };
  return { on, end };
}

/**
 * The Tasks from `from` whose waits, each on the next, lead to `to`, from `from` on and leaving
 * `to` out; `from` alone when it is `to`. Null when no wait that still holds leads there. Only a
 * Task waits, so a cycle runs through Tasks alone.
 */
function waitPath(sql: SqlStorage, from: string, to: string, today: Day): Task[] | null {
  const waiters = sql
    .exec<TaskRow>(
      `SELECT * FROM tasks WHERE id IN (
         SELECT task FROM task_events WHERE what = 'waited_on' AND on_kind = 'task')`,
    )
    .toArray();
  const tasks = new Map(tasksFrom(sql, waiters, today).map((task) => [task.id, task]));
  const before = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    if (at === to) break;
    const state = tasks.get(at)?.state;
    for (const wait of state?.is === "open" ? (state.waiting ?? []) : []) {
      if (wait.on.kind !== "task" || before.has(wait.on.id)) continue;
      before.set(wait.on.id, at);
      queue.push(wait.on.id);
    }
  }
  if (!before.has(to)) return null;
  if (from === to) return [readTask(sql, from, today) as Task];
  const path: Task[] = [];
  for (let at = before.get(to) ?? null; at !== null; at = before.get(at) ?? null) {
    path.unshift(tasks.get(at) as Task);
  }
  return path;
}

/** Whether a Task waits on this Task or Project now. Only an open Task waits. */
function waitsOn(task: Task, on: WaitTarget): boolean {
  const key = waitKey(on);
  return (
    task.state.is === "open" && (task.state.waiting ?? []).some((wait) => waitKey(wait.on) === key)
  );
}
