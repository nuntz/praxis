import type { CallEnd, CallRecord, EndHeardBy, ProviderEnd } from "@praxis/domain";
import { instantToIso } from "@praxis/domain";

/**
 * A Call's row (steps/context-0002.ts). The Context's object runs its Call tools one at a time, so
 * nothing changes a Call's row while one of them waits on the provider.
 */
export type CallRow = {
  id: string;
  session: string;
  at: number;
  ended_at: number | null;
  ended: CallEnd | null;
  provider_reason: string | null;
  end_heard_by: EndHeardBy | null;
};

/** Keep a Call the object has set up at the provider, going from `at`. */
export function insertCall(sql: SqlStorage, call: { id: string; session: string; at: number }) {
  sql.exec(`INSERT INTO calls (id, session, at) VALUES (?, ?, ?)`, call.id, call.session, call.at);
}

export function callById(sql: SqlStorage, id: string): CallRow | null {
  return sql.exec<CallRow>(`SELECT * FROM calls WHERE id = ?`, id).toArray()[0] ?? null;
}

/** The Calls in this Context still going, oldest first. */
export function callsGoing(sql: SqlStorage): CallRow[] {
  return sql.exec<CallRow>(`SELECT * FROM calls WHERE ended IS NULL ORDER BY seq`).toArray();
}

/**
 * End a Call as it was reported or found, at `at`, with what the Device heard of the provider
 * ending its session, if it heard anything.
 */
export function endCall(
  sql: SqlStorage,
  id: string,
  end: { at: number; ended: CallEnd; heard: ProviderEnd },
): void {
  sql.exec(
    `UPDATE calls SET ended_at = ?, ended = ?, provider_reason = ?, end_heard_by = ? WHERE id = ?`,
    end.at,
    end.ended,
    end.heard?.reason ?? null,
    end.heard === null ? null : "device",
    id,
  );
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

/** A Call's record, as `end_call` answers with it: no words, and none were ever kept. */
export function callRecord(row: CallRow): CallRecord {
  return {
    id: row.id,
    at: instantToIso(row.at),
    ended_at: row.ended_at === null ? null : instantToIso(row.ended_at),
    ended: row.ended,
    provider_reason: row.provider_reason,
    end_heard_by: row.end_heard_by,
  };
}
