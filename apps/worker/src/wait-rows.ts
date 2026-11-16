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
      `SELECT * FROM tasks WHERE id IN (
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
