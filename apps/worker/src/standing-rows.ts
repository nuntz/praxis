import {
  type Day,
  dayIn,
  type InTheWay,
  refusal,
  STANDING_CEILING,
  standingSize,
  summarizeWords,
  type ToolResult,
} from "@praxis/domain";

/** An Entry's id, and its words as they would stand. */
type EntryWords = { id: string; words: string };

const characters = (count: number) => count.toLocaleString("en");

/**
 * The refusal of a change that would take the Context's Standing Entries past the ceiling
 * (section 5.5), or null when it does not: this Entry standing with these words, beside every
 * other Standing Entry. One in the Trash keeps its room, so restoring it is never refused and
 * nothing is dropped from it; removing it for good frees the room. The others are what is in the
 * way, newest first, since unmarking or shortening one makes room.
 */
export function pastTheCeiling(sql: SqlStorage, entry: EntryWords): ToolResult<never> | null {
  const others = sql
    .exec<EntryWords>(
      `SELECT id, words FROM entries
       WHERE id IN (SELECT entry FROM standing_marks) AND id != ?
       ORDER BY at DESC, seq DESC`,
      entry.id,
    )
    .toArray();
  const held = others.reduce((sum, { words }) => sum + standingSize(words), 0);
  if (held + standingSize(entry.words) <= STANDING_CEILING) return null;
  const inTheWay = others.map(
    ({ id, words }): InTheWay => ({ kind: "entry", id, summary: summarizeWords(words) }),
  );
  return refusal(
    `A Context's Standing Entries hold ${characters(STANDING_CEILING)} characters in all at most, and this would pass that: the others hold ${characters(held)}, and this Entry ${characters(standingSize(entry.words))}. Unmark or shorten a Standing Entry first. One in the Trash keeps its room until it is removed for good.`,
    inTheWay,
  );
}

/** A Standing Entry as the Agent is given it at the start of a Run: its id, day and words. */
export type StandingEntry = { id: string; day: Day; words: string };

/**
 * The Context's Standing Entries not in the Trash, oldest first, each with the day it was made in
 * the Context's time zone, so the newer of two that disagree is the later.
 */
export function standingEntries(sql: SqlStorage, timeZone: string): StandingEntry[] {
  return sql
    .exec<{ id: string; at: number; words: string }>(
      `SELECT id, at, words FROM standing_entries ORDER BY at, seq`,
    )
    .toArray()
    .map(({ id, at, words }) => ({ id, day: dayIn(at, timeZone), words }));
}
