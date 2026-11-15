import type { Caller, Effect } from "@praxis/domain";

/** Put one write's Effects in the change log, with its caller and when it arrived. */
export function appendChange(
  sql: SqlStorage,
  change: { at: number; caller: Caller; tool: string; effects: Effect[] },
): void {
  const { caller } = change;
  const { seq } = sql
    .exec<{ seq: number }>(
      `INSERT INTO change_calls (at, caller_kind, caller_name, tool) VALUES (?, ?, ?, ?)
       RETURNING seq`,
      change.at,
      caller.kind,
      "name" in caller ? caller.name : null,
      change.tool,
    )
    .one();
  change.effects.forEach((effect, ord) => {
    sql.exec(
      `INSERT INTO changes (call, ord, kind, record_id, what, summary, by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seq,
      ord,
      effect.kind,
      effect.id,
      effect.what,
      effect.summary,
      effect.by,
    );
  });
}
