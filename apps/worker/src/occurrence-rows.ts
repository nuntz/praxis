import { addDays, type Day, daysBetween, nextDueDate, type Task } from "@praxis/domain";
import { insertTask, insertTaskEvent, readTask, setRecurrence } from "./task-rows.ts";

/**
 * An open Task is being closed today: if it is recurring, its rule moves on to the next
 * Occurrence, made here, and this one becomes a plain Task. The next carries the title, the
 * Project, the rule, the delegation, the Origin Entry and the gap in days from its Defer Date to
 * its Due Date; its waits and the References to it stay behind. Returns the next Occurrence, or
 * null when the Task was not recurring.
 */
export function makeNextOccurrence(
  sql: SqlStorage,
  closing: Task,
  at: number,
  today: Day,
): Task | null {
  const { recurrence, due_date: due, defer_date: defer } = closing;
  if (recurrence === null || due === null) return null;
  const nextDue = nextDueDate(recurrence, due, today);
  setRecurrence(sql, closing.id, null);
  const id = insertTask(sql, {
    title: closing.title,
    originEntry: closing.origin_entry,
    at,
    author: closing.author,
    project: closing.project,
    dates: {
      due_date: nextDue,
      defer_date: defer === null ? null : addDays(nextDue, daysBetween(due, defer)),
    },
    recurrence,
  });
  const delegated = closing.state.is === "open" ? closing.state.delegated : null;
  if (delegated) insertTaskEvent(sql, id, { what: "delegated", at, to: delegated.to });
  return readTask(sql, id, today);
}
