import type { CallEnd, CallRecord, EndHeardBy, ProviderEnd } from "@praxis/domain";
import { instantToIso } from "@praxis/domain";
import { VOICE_PRICE_PER_MINUTE } from "./voice/gpt-live-1.1.ts";

/**
 * A Call's row (steps/context-0002.ts, context-0003.ts). Every write that ends one names the
 * state it read as well as the row, `ended IS NULL`, since a Call tool, the alarm and the Deployment
 * object ending it for the next one may each have waited on something meanwhile.
 */
export type CallRow = {
  id: string;
  session: string;
  at: number;
  ended_at: number | null;
  ended: CallEnd | null;
  provider_reason: string | null;
  end_heard_by: EndHeardBy | null;
  alive_at: number;
  cost: number | null;
};

/** Keep a Call the object has set up at the provider, going from `at`, alive as it is set up. */
export function insertCall(sql: SqlStorage, call: { id: string; session: string; at: number }) {
  sql.exec(
    `INSERT INTO calls (id, session, at, alive_at) VALUES (?, ?, ?, ?)`,
    call.id,
    call.session,
    call.at,
    call.at,
  );
}

export function callById(sql: SqlStorage, id: string): CallRow | null {
  return sql.exec<CallRow>(`SELECT * FROM calls WHERE id = ?`, id).toArray()[0] ?? null;
}

/** The Calls in this Context still going, oldest first. */
export function callsGoing(sql: SqlStorage): CallRow[] {
  return sql.exec<CallRow>(`SELECT * FROM calls WHERE ended IS NULL ORDER BY seq`).toArray();
}

/** Note a sign of life from the Device in a Call, at `at`. */
export function noteAlive(sql: SqlStorage, id: string, at: number): void {
  sql.exec(`UPDATE calls SET alive_at = ? WHERE id = ?`, at, id);
}

/** The voice provider's limit on a session, past which no Call is counted: it has ended it. */
const PROVIDER_LIMIT = 2 * 60 * 60 * 1000;

/**
 * How long a Call went, from `at` to `to`, in whole seconds by the object's clock: a part of one
 * counts as a whole, as the provider bills by the second, and none past the provider's two-hour
 * limit, as when the object ends a Call late.
 */
export function callSeconds(at: number, to: number): number {
  return Math.ceil(Math.min(Math.max(0, to - at), PROVIDER_LIMIT) / 1000);
}

/** What a Call of these seconds costs, in US dollars, at the voice model's one rate. */
export function callCost(seconds: number): number {
  return (seconds * VOICE_PRICE_PER_MINUTE) / 60;
}

/**
 * End a Call still going, as it was reported or found, at `at`, with what the Device heard of the
 * provider ending its session, if it heard anything, and what it cost. False when it had ended
 * already, and nothing changes.
 */
export function endCall(
  sql: SqlStorage,
  id: string,
  end: { at: number; ended: CallEnd; heard: ProviderEnd },
): boolean {
  const call = callById(sql, id);
  if (call === null || call.ended !== null) return false;
  sql.exec(
    `UPDATE calls SET ended_at = ?, ended = ?, provider_reason = ?, end_heard_by = ?, cost = ?
     WHERE id = ?`,
    end.at,
    end.ended,
    end.heard?.reason ?? null,
    end.heard === null ? null : "device",
    callCost(callSeconds(call.at, end.at)),
    id,
  );
  return true;
}

/** Keep what the object heard of the provider ending a Call's session on its side channel. */
export function keepEndHeardByObject(sql: SqlStorage, id: string, heard: ProviderEnd): void {
  if (heard === null) return;
  sql.exec(
    `UPDATE calls SET provider_reason = ?, end_heard_by = 'object' WHERE id = ?`,
    heard.reason,
    id,
  );
}

/**
 * What the Calls cost in the calendar month from `start` to `end`, in US dollars, as at `now`: each
 * for its time in that month, one still going up to `now`. A Call going as the month turns counts
 * in each month for its time in it, so the cap of the month it runs into ends it. One within a
 * month is counted at its record's cost.
 */
export function callsSpent(sql: SqlStorage, bounds: { start: number; end: number }, now: number) {
  let spent = 0;
  for (const call of sql
    .exec<Pick<CallRow, "at" | "ended_at" | "cost">>(
      `SELECT at, ended_at, cost FROM calls
       WHERE at < ? AND (ended_at IS NULL OR ended_at >= ?)`,
      bounds.end,
      bounds.start,
    )
    .toArray()) {
    const to = call.ended_at ?? now;
    if (call.cost !== null && call.at >= bounds.start && to < bounds.end) spent += call.cost;
    else spent += callCost(callSeconds(Math.max(call.at, bounds.start), Math.min(to, bounds.end)));
  }
  return spent;
}

/** A Call's record, as the Call tools answer with it: no words, and none were ever kept. */
export function callRecord(row: CallRow): CallRecord {
  return {
    id: row.id,
    at: instantToIso(row.at),
    ended_at: row.ended_at === null ? null : instantToIso(row.ended_at),
    ended: row.ended,
    seconds: row.ended_at === null ? null : callSeconds(row.at, row.ended_at),
    cost: row.cost,
    provider_reason: row.provider_reason,
    end_heard_by: row.end_heard_by,
  };
}
