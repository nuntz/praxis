import { type Caller, type Change, failure, PAGE_SIZE, success } from "@praxis/domain";
import {
  changesAfter,
  decodeCursor,
  encodeCursor,
  lastChange,
  prunedThrough,
} from "../change-log.ts";
import type { Handlers } from "../registry.ts";

/** Whether a caller is an outside agent, which is shown nothing of a Held Change (section 4.7). */
function isConnection(caller: Caller): boolean {
  return caller.kind === "connection" || caller.kind === "read_only_connection";
}

/**
 * A change as a Connection reads it: without its Effects on Held Changes, and not at all when
 * those were all it had. The person's tap that made one still shows as the change it made.
 */
function withoutHeldChanges(change: Change): Change[] {
  const effects = change.effects.filter((effect) => effect.kind !== "held_change");
  return effects.length === 0 ? [] : [{ ...change, effects }];
}

export const changeTools: Pick<Handlers, "list_changes"> = {
  list_changes({ caller, input, sql }) {
    const pruned = prunedThrough(sql);
    // Without a cursor the list starts from the oldest change kept.
    let after = pruned;
    if (input.cursor !== undefined) {
      const position = decodeCursor(input.cursor);
      if (position === null)
        return failure("invalid_input", "The cursor is not one this list gave.");
      after = position;
    }
    // Some of what changed since the cursor is gone from the log, so no page from it is whole.
    if (after < pruned) {
      return success({
        items: [],
        cursor: encodeCursor(lastChange(sql)),
        more: false,
        read_afresh: true,
      });
    }
    const { items, last, more } = changesAfter(sql, after, PAGE_SIZE);
    const shown = isConnection(caller) ? items.flatMap(withoutHeldChanges) : items;
    return success({ items: shown, cursor: encodeCursor(last), more, read_afresh: false });
  },
};
