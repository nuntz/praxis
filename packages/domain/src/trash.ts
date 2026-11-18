import type { RecordKind } from "./effects.ts";

/** Days a delete stays in the Trash before it is removed for good (section 3.8). */
export const TRASH_DAYS = 30;

/** The instant an item deleted at `deletedAt` is removed for good, unless emptied before. */
export function removedForGoodAt(deletedAt: number): number {
  return deletedAt + TRASH_DAYS * 24 * 60 * 60 * 1000;
}

/** A record as the Trash names it: its kind, its id and its one-line summary. */
export type RecordNamed = { kind: RecordKind; id: string; summary: string };

/**
 * What one delete sent to the Trash (section 3.8): the record deleted and what went with it,
 * with one clock counted from the delete, and back together on a restore. An item is known by
 * the id of any record in it.
 */
export type TrashItem = {
  /** The record deleted. */
  record: RecordNamed;
  /** What could not exist without it, in the order it was made. */
  went_with: RecordNamed[];
  /** When it was deleted, as an ISO 8601 instant. */
  deleted_at: string;
  /** When it will be removed for good, 30 days after the delete, as an ISO 8601 instant. */
  removed_at: string;
};

/** What a removal for good returns: how many items it removed. Nothing of them is left to show. */
export type Removal = { items: number };
