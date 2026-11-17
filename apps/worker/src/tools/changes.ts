import { failure, PAGE_SIZE, success } from "@praxis/domain";
import {
  changesAfter,
  decodeCursor,
  encodeCursor,
  lastChange,
  prunedThrough,
} from "../change-log.ts";
import type { Handlers } from "../registry.ts";

export const changeTools: Pick<Handlers, "list_changes"> = {
  list_changes({ input, sql }) {
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
    return success({ items, cursor: encodeCursor(last), more, read_afresh: false });
  },
};
