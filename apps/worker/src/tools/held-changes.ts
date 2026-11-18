import { type Day, type Entry, failure, success, written } from "@praxis/domain";
import {
  endHeldChange,
  type HeldRow,
  heldChangesFrom,
  heldRow,
  newTasksOf,
  readHeldChange,
} from "../held-change-rows.ts";
import { newestFirst } from "../newest-first.ts";
import type { Handlers } from "../registry.ts";
import { pastTheCeilingWith, putWords, readEntry } from "./entries.ts";
import { sendEntryToTrash } from "./trash.ts";

const NO_SUCH_HELD_CHANGE =
  "No such Held Change: it was made, cancelled, or lapsed when its Entry changed.";

export const heldChangeTools: Pick<
  Handlers,
  "make_held_change" | "cancel_held_change" | "list_held_changes"
> = {
  make_held_change({ input, arrivedAt, today, sql }) {
    const row = heldRow(sql, input.id);
    const held = row && heldChangesFrom(sql, [row])[0];
    // It lapses the moment its Entry changes, so the Entry is as the Held Change shows it.
    const entry = row && readEntry(sql, row.entry, today);
    if (!row || !held || !entry) return failure("not_found", NO_SUCH_HELD_CHANGE);
    // The tap makes the change the Agent asked for, so its words are the Agent's.
    const made =
      row.tool === "delete_entry"
        ? sendEntryToTrash(sql, entry, arrivedAt, today)
        : changeAsShown(sql, row, entry, { at: arrivedAt, today });
    if ("ok" in made) return made;
    // A change to the Entry lapses every other Held Change on it, by rule, after this one ends.
    return success(written(held, [...made.effects, endHeldChange(sql, held, "call")]));
  },

  cancel_held_change({ input, sql }) {
    const held = readHeldChange(sql, input.id);
    if (!held) return failure("not_found", NO_SUCH_HELD_CHANGE);
    return success(written(held, [endHeldChange(sql, held, "call")]));
  },

  list_held_changes({ input, sql }) {
    const page = newestFirst("held_changes", input.cursor, (before) =>
      sql.exec<HeldRow>(`SELECT * FROM held_changes WHERE seq < ? ORDER BY seq DESC`, before),
    );
    if (!page.ok) return page;
    return success({
      items: heldChangesFrom(sql, page.value.rows),
      next_cursor: page.value.next_cursor,
    });
  },
};

/**
 * The change to the words a Held Change shows, made as the Agent's. A Standing Entry's words are
 * held to the ceiling here too, since the other Standing Entries may have grown since it was left.
 */
function changeAsShown(
  sql: SqlStorage,
  row: HeldRow,
  entry: Entry,
  { at, today }: { at: number; today: Day },
) {
  const words = row.words as string;
  const refused = pastTheCeilingWith(sql, entry, words);
  if (refused) return refused;
  return putWords(sql, entry, words, newTasksOf(row), {
    by: { kind: "agent" },
    becomesTheirs: false,
    at,
    today,
  });
}
