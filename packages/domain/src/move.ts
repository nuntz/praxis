import type { ContextListing } from "./deployment.ts";
import type { ExportedMove } from "./export.ts";
import type { RecordNamed } from "./trash.ts";

/**
 * What the person moves to another Context (section 3.9): an Entry or a Project, each with its
 * whole unit.
 */
export type MoveKind = "entry" | "project";

/**
 * What moving a record would take, for the person to see before confirming (section 3.9). An
 * Entry's unit is the Entry, its Follow-ups and theirs in turn, and the Tasks that came from them,
 * every Occurrence of a recurring one among them. A Project's is the Project, its Tasks, their
 * Origin Entries, those Entries' Follow-ups and theirs in turn, and any other Tasks those Entries
 * made. None in the Trash is in it.
 */
export type MoveUnit = {
  /** The record asked for. */
  record: RecordNamed;
  /** Everything that goes: the record asked for first, then the Entries, then the Tasks. */
  unit: RecordNamed[];
  /**
   * The Tasks in the Trash whose Origin Entry would go. A Task never leaves its Origin Entry, and
   * nothing in the Trash moves, so while there is one the move is refused: restoring it, or
   * removing it for good, mends that.
   */
  in_the_trash: RecordNamed[];
};

/** What `move_record` returns as its record: what moved, from where to where. */
export type Moved = {
  record: RecordNamed;
  unit: RecordNamed[];
  from: ContextListing;
  to: ContextListing;
  /**
   * False when the Context moved to did not say it took the unit. It may not have, when the unit
   * is in neither Context's view until the source's alarm carries it there, or it may have and
   * its answer was lost. Either way the Effects returned are the source's alone, and the Context
   * moved to holds its own in its change log.
   */
  arrived: boolean;
};

/**
 * A unit as it travels from one Context's object to another's, in the shapes an Export's file
 * holds records in, with whatever linked across the boundary already dropped. The Deployment
 * object carries it and reads none of it.
 */
export type MovingUnit = Pick<ExportedMove, "entries" | "tasks" | "projects">;
