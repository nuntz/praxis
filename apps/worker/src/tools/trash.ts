import {
  type Day,
  type Entry,
  failure,
  HELD_FOR_A_CONNECTION,
  type Removal,
  success,
  type ToolResult,
  type TrashItem,
  type Written,
  written,
} from "@praxis/domain";
import { leaveHeldChange } from "../held-change-rows.ts";
import { newestFirst } from "../newest-first.ts";
import { readPerson } from "../person-rows.ts";
import { readProject } from "../project-rows.ts";
import type { Handlers } from "../registry.ts";
import { readTask } from "../task-rows.ts";
import {
  deleted,
  type ItemRow,
  itemHolding,
  itemsDeletedBy,
  itemsFrom,
  leaveProject,
  removeForGood,
  restoreItem,
  sendToTrash,
  stopWaitsOn,
  takeBackFrom,
} from "../trash-rows.ts";
import { NO_SUCH_ENTRY, readEntry } from "./entries.ts";
import { NO_SUCH_PERSON } from "./persons.ts";
import { NO_SUCH_PROJECT } from "./projects.ts";
import { NO_SUCH_TASK } from "./tasks.ts";

const NOT_IN_THE_TRASH = "No such record in this Context's Trash.";

/** These items removed for good: what a removal returns, which is only how many went. */
function removal(sql: SqlStorage, items: string[], today: Day): ToolResult<Written<Removal>> {
  const { items: count, effects } = removeForGood(sql, items, today);
  return success(written({ items: count }, effects));
}

/**
 * Send an Entry to the Trash. The Tasks it is the Origin Entry of cannot exist without it, every
 * Occurrence among them, open or closed, and so do its own References and Mentions. A Follow-up
 * of it stays, and so does every other link to it, dormant. A Task already in the Trash stays in
 * its own item.
 */
export function sendEntryToTrash(
  sql: SqlStorage,
  entry: Entry,
  at: number,
  today: Day,
): Written<TrashItem> {
  const tasks = entry.tasks.map((task) => ({ kind: "task" as const, id: task.id }));
  const item = sendToTrash(sql, { kind: "entry", id: entry.id }, tasks, at);
  const waiters = stopWaitsOn(sql, item, tasks, at, today);
  return deleted(sql, item, waiters, today);
}

export const trashTools: Pick<
  Handlers,
  | "delete_entry"
  | "delete_task"
  | "delete_project"
  | "delete_person"
  | "list_trash"
  | "restore"
  | "remove_for_good"
  | "empty_trash"
> = {
  delete_entry({ caller, input, arrivedAt, today, sql }) {
    const entry = readEntry(sql, input.id, today);
    if (!entry) return failure("not_found", NO_SUCH_ENTRY);
    // Deleting the person's words is theirs alone. The Agent's call leaves a Held Change for the
    // person's tap, listing the Tasks that would go with it; a Connection's is refused.
    if (entry.author.kind === "person" && caller.kind !== "hand") {
      if (caller.kind !== "agent") return failure("held", HELD_FOR_A_CONNECTION);
      return success(
        leaveHeldChange(sql, {
          tool: "delete_entry",
          entry,
          words: null,
          newTasks: [],
          at: arrivedAt,
        }),
      );
    }
    return success(sendEntryToTrash(sql, entry, arrivedAt, today));
  },

  delete_task({ input, arrivedAt, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    // Its Recurrence is on it, so it goes with it, and no next Occurrence is made: deleting is not
    // closing. Its Origin Entry is never touched.
    const item = sendToTrash(sql, { kind: "task", id: task.id }, [], arrivedAt);
    const waiters = stopWaitsOn(sql, item, [{ kind: "task", id: task.id }], arrivedAt, today);
    return success(deleted(sql, item, waiters, today));
  },

  delete_project({ input, arrivedAt, today, sql }) {
    const project = readProject(sql, input.id, today);
    if (!project) return failure("not_found", NO_SUCH_PROJECT);
    // Nothing goes with it: its Tasks are each its own, Finished ones among them, so they stay
    // and show no Project. Dropping it first is how the work in it is given up.
    const item = sendToTrash(sql, { kind: "project", id: project.id }, [], arrivedAt);
    const left = leaveProject(sql, item, project.id, today);
    const waiters = stopWaitsOn(sql, item, [{ kind: "project", id: project.id }], arrivedAt, today);
    return success(deleted(sql, item, [...left, ...waiters], today));
  },

  delete_person({ input, arrivedAt, today, sql }) {
    const person = readPerson(sql, input.id);
    if (!person) return failure("not_found", NO_SUCH_PERSON);
    // Nothing goes with them: a Task Delegated to them is the person's to track, so it is taken
    // back, and each Mention of them stays dormant.
    const item = sendToTrash(sql, { kind: "person", id: person.id }, [], arrivedAt);
    const takenBack = takeBackFrom(sql, item, person.id, arrivedAt, today);
    return success(deleted(sql, item, takenBack, today));
  },

  restore({ input, arrivedAt, today, sql }) {
    const item = itemHolding(sql, input.id);
    if (!item) return failure("not_found", NOT_IN_THE_TRASH);
    const restored = restoreItem(sql, item, arrivedAt, today);
    return success(written(restored.item, restored.effects));
  },

  remove_for_good({ input, today, sql }) {
    const item = itemHolding(sql, input.id);
    if (!item) return failure("not_found", NOT_IN_THE_TRASH);
    return removal(sql, [item], today);
  },

  empty_trash({ input, today, sql }) {
    // Only what was deleted by the newest item the person was shown: a delete after it stays.
    return removal(sql, itemsDeletedBy(sql, Date.parse(input.up_to)), today);
  },

  list_trash({ input, sql }) {
    const page = newestFirst("trash", input.cursor, (before) =>
      sql.exec<ItemRow>(`SELECT * FROM trash_items WHERE seq < ? ORDER BY seq DESC`, before),
    );
    if (!page.ok) return page;
    return success({
      items: itemsFrom(sql, page.value.rows),
      next_cursor: page.value.next_cursor,
    });
  },
};
