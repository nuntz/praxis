/**
 * The one Call going in the Deployment (section 6), as the Deployment object keeps it
 * (steps/deployment-0002.ts): the Context it is in and its id there. It holds no words.
 */
export type CallGoing = { context_id: string; call: string };

/** The Call the Deployment object was last told is going, or null when none is. */
function callGoing(sql: SqlStorage): CallGoing | null {
  return sql.exec<CallGoing>(`SELECT context_id, call FROM call_going`).toArray()[0] ?? null;
}

/**
 * Name this Call the one going, and answer with the one it takes the place of, if another was:
 * the caller ends that one in its Context.
 */
export function nameCallGoing(sql: SqlStorage, going: CallGoing): CallGoing | null {
  const before = callGoing(sql);
  sql.exec(
    `INSERT INTO call_going (one, context_id, call) VALUES (1, ?, ?)
     ON CONFLICT (one) DO UPDATE SET context_id = excluded.context_id, call = excluded.call`,
    going.context_id,
    going.call,
  );
  return before === null || before.call === going.call ? null : before;
}

/** This Call has ended: none is going, unless another has started since and is named instead. */
export function callNoLongerGoing(sql: SqlStorage, ended: CallGoing): void {
  sql.exec(
    `DELETE FROM call_going WHERE context_id = ? AND call = ?`,
    ended.context_id,
    ended.call,
  );
}
