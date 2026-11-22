import { type Change, failure, isConnection, PAGE_SIZE, success } from "@praxis/domain";
import {
  changesAfter,
  changesBefore,
  decodeCursor,
  encodeCursor,
  lastChange,
  prunedThrough,
} from "../change-log.ts";
import { listCursor, listPosition } from "../newest-first.ts";
import type { Handlers } from "../registry.ts";

/**
 * The list a cursor of the log read newest first belongs to, so it is never taken for one that
 * reads forward, nor the other way about.
 */
const NEWEST_FIRST = "changes_newest_first";

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
    const shown = (items: Change[]) =>
      isConnection(caller) ? items.flatMap(withoutHeldChanges) : items;
    if (input.newest_first === true) {
      // Without a cursor the list starts from the newest change.
      let before = Number.MAX_SAFE_INTEGER;
      if (input.cursor !== undefined) {
        const position = listPosition(NEWEST_FIRST, input.cursor);
        if (position === null)
          return failure("invalid_input", "The cursor is not one this list gave.");
        before = position;
      }
      const { items, oldest, more } = changesBefore(sql, before, PAGE_SIZE, input.caller);
      return success({
        items: shown(items),
        cursor: listCursor(NEWEST_FIRST, oldest),
        more,
        read_afresh: false,
      });
    }
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
    const { items, last, more } = changesAfter(sql, after, PAGE_SIZE, input.caller);
    return success({ items: shown(items), cursor: encodeCursor(last), more, read_afresh: false });
  },
};
