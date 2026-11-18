import { type Day, type Task, type WaitTarget, waitKey } from "@praxis/domain";
import { insertTaskEvent, readTask, type TaskRow, tasksFrom } from "./task-rows.ts";

/**
 * These Tasks and Projects have reached an end, so every wait on them ends: each open Task
 * waiting on one is released from it. Returns the Tasks released, in the order they were made,
 * as they are now. A Task closed in the same change has no waits left to release.
 */
export function releaseWaitsOn(
  sql: SqlStorage,
  closed: WaitTarget[],
  at: number,
  today: Day,
): Task[] {
  const keys = new Set(closed.map(waitKey));
  const rows = sql
    .exec<TaskRow>(
      `SELECT * FROM untrashed_tasks WHERE id IN (
         SELECT task FROM task_events
         WHERE what = 'waited_on' AND on_id IN (SELECT value FROM json_each(?)))
       ORDER BY seq`,
      JSON.stringify(closed.map(({ id }) => id)),
    )
    .toArray();
  return tasksFrom(sql, rows, today).flatMap((task) => {
    if (task.state.is !== "open") return [];
    const ended = (task.state.waiting ?? []).filter(({ on }) => keys.has(waitKey(on)));
    if (ended.length === 0) return [];
    for (const { on } of ended) {
      insertTaskEvent(sql, task.id, { what: "released", at, on: { kind: on.kind, id: on.id } });
    }
    return [readTask(sql, task.id, today) as Task];
  });
}

/**
 * The Tasks from `from` whose waits, each on the next, lead to `to`, from `from` on and leaving
 * `to` out; `from` alone when it is `to`. Null when no wait that still holds leads there. Only a
 * Task waits, so a cycle runs through Tasks alone.
 */
export function waitPath(sql: SqlStorage, from: string, to: string, today: Day): Task[] | null {
  const waiters = sql
    .exec<TaskRow>(
      `SELECT * FROM untrashed_tasks WHERE id IN (
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
