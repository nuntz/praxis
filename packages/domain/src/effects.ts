import type { Caller } from "./callers.ts";

/** The kinds of record an Effect can name. */
export type RecordKind = "entry";

/**
 * One thing a change brought about (section 4.4): a record made, changed or deleted, and whether
 * the call did it directly or a rule did. The record a write is about is an Effect of the call
 * like any other, so the Effects are everything the write changed.
 */
export type Effect = {
  kind: RecordKind;
  id: string;
  what: "made" | "changed" | "deleted";
  /** The record's one-line summary, the same one reads use. */
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
 * A page of the change log, oldest first. Unlike other lists the cursor is always given, so a
 * caller that has read to the end can ask again later for what changed since.
 */
export type ChangesPage = { items: Change[]; cursor: string; more: boolean };
