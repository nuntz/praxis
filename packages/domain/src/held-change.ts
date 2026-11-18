import type { Written } from "./effects.ts";
import type { EntryNamed } from "./entry.ts";
import type { NewTask } from "./task.ts";
import type { RecordNamed } from "./trash.ts";

/** The calls that can leave a Held Change (section 4.7): each changes or deletes an Entry's words. */
export type HeldTool = "edit_entry" | "restore_entry_version" | "delete_entry";

/**
 * A Held Change (section 4.7): a call from the Agent that would change or delete the words of an
 * Entry whose Author is the person, waiting for the person's tap. It is not a record. It shows the
 * Entry before and after, and for a delete the Tasks that would go with it, so the tap covers
 * them. It lapses the moment the Entry changes underneath it, so a tap never makes a change other
 * than the one shown.
 */
export type HeldChange = {
  id: string;
  /** The call the Agent made, which the person's tap makes. */
  tool: HeldTool;
  /** Its one-line summary, which holds none of the words. */
  summary: string;
  /** The Entry it would change. */
  entry: EntryNamed;
  /** The Entry's words as they are. */
  before: string;
  /** The words the tap gives it, or null for a delete. */
  after: string | null;
  /** The Tasks the tap makes with the new words: the Inline Tasks an edit added. */
  new_tasks: NewTask[];
  /** For a delete, the Tasks that would go with the Entry, open or closed, in the order made. */
  goes_with: RecordNamed[];
  /** When the Agent left it, as an ISO 8601 instant. */
  at: string;
};

/**
 * What a held call returns to the Agent: not an error, but the Held Change it left, whose making
 * is its one Effect.
 */
export type Held = Written<HeldChange> & { held: true };

/** A Held Change's one-line summary: what the tap would do, in no words of the Entry's. */
export const HELD_SUMMARY: Record<HeldTool, string> = {
  edit_entry: "Edit your Entry's words",
  restore_entry_version: "Restore an earlier Version of your Entry",
  delete_entry: "Delete your Entry",
};

/** Whether a write's result is a Held Change it left rather than the change it asked for. */
export function isHeld(value: object): value is Held {
  return "held" in value && value.held === true;
}
