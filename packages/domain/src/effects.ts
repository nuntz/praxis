import type { Caller } from "./callers.ts";
import { daysBefore } from "./day.ts";

/** The kinds of record. */
export type RecordKind = "entry" | "task" | "project" | "person";

/**
 * What an Effect can name: a record, the Context itself, whose settings a write can change, a
 * Held Change, waiting in the Context for the person's tap, a Connection, a Device, or the spend
 * cap, the last three of which the Deployment object keeps. None of these but the records is a
 * record, but a change to one is a change like any other.
 */
export type EffectKind =
  | RecordKind
  | "context"
  | "held_change"
  | "connection"
  | "device"
  | "spend_cap";

/**
 * One thing a change brought about (section 4.4): a record made, changed or deleted, or the
 * Context's settings changed, and whether the call did it directly or a rule did. The record a
 * write is about is an Effect of the call like any other, so the Effects are everything the
 * write changed.
 */
export type Effect = {
  kind: EffectKind;
  id: string;
  what: "made" | "changed" | "deleted";
  /** The one-line summary reads use: a record's, or the Context's name. */
  summary: string;
  by: "call" | "rule";
};

/** What every write returns: the record it changed and its Effects. */
export type Written<R> = {
  record: R;
  effects: Effect[];
  /** False when the call asked for what was already so, and nothing changed. */
  changed: boolean;
};

export function written<R>(record: R, effects: Effect[]): Written<R> {
  return { record, effects, changed: effects.length > 0 };
}

/** One write's Effects as the change log keeps them, with its caller and when it arrived. */
export type Change = {
  /** When the call arrived, as an ISO 8601 instant. */
  at: string;
  caller: Caller;
  tool: string;
  effects: Effect[];
};

/**
 * A page of the change log, oldest first, or newest first when asked. Unlike other lists the
 * cursor is always given, so a caller that has read to the end can ask again later for what
 * changed since.
 */
export type ChangesPage = {
  items: Change[];
  /**
   * Where to ask from next: after the last change read, oldest first; before the oldest given,
   * newest first.
   */
  cursor: string;
  /** Whether more follow the page: later ones oldest first, earlier ones newest first. */
  more: boolean;
  /**
   * True when the cursor asked from is older than the change log keeps, so some of what changed
   * since is gone from it. The page then holds nothing, and its cursor is where the log stands:
   * the caller reads what it shows afresh and asks from there. Never so newest first, which only
   * reaches back to the oldest change kept.
   */
  read_afresh: boolean;
};

/** Days the change log keeps a change (section 4.4). */
export const CHANGE_LOG_DAYS = 90;

/** A change that arrived at or before the instant this returns is pruned by `at`. */
export function changesPrunedBy(at: number): number {
  return daysBefore(at, CHANGE_LOG_DAYS);
}

/**
 * An Effect on a Connection: made, renamed, switched to or from reading only, or ended, by the
 * call; or by rule, ended when its Context is retired and deleted when it is deleted. Summarised
 * by its name.
 */
export function effectOnConnection(
  connection: { id: string; name: string },
  what: Effect["what"],
  by: Effect["by"] = "call",
): Effect {
  return { kind: "connection", id: connection.id, what, summary: connection.name, by };
}

/**
 * An Effect on a Device: listed once something is switched on there, renamed, switched, or gone
 * from the list once nothing is. Summarised by its name.
 */
export function effectOnDevice(device: { id: string; name: string }, what: Effect["what"]): Effect {
  return { kind: "device", id: device.id, what, summary: device.name, by: "call" };
}

/**
 * An Effect on a Context: a change to its settings, or, from the Deployment object, the Context
 * made, renamed, given another accent, retired, brought back or deleted. Summarised by its name.
 */
export function effectOnContext(
  context: { id: string; name: string },
  what: Effect["what"],
): Effect {
  return { kind: "context", id: context.id, what, summary: context.name, by: "call" };
}
