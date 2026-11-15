import { type Caller, keysForgottenBy, type ToolResult } from "@praxis/domain";

/**
 * The first call a caller made with a key, while the key is remembered at `at`. A key past its
 * 30 days counts as forgotten whether or not the alarm has got to it yet.
 */
export function firstWithKey(
  sql: SqlStorage,
  caller: Caller,
  key: string,
  at: number,
): { tool: string; result: ToolResult<unknown> } | null {
  const row = sql
    .exec<{ tool: string; result: string }>(
      `SELECT tool, result FROM write_keys WHERE caller = ? AND key = ? AND at > ?`,
      callerKey(caller),
      key,
      keysForgottenBy(at),
    )
    .toArray()[0];
  return row ? { tool: row.tool, result: JSON.parse(row.result) } : null;
}

export function rememberKey(
  sql: SqlStorage,
  first: { caller: Caller; key: string; tool: string; at: number; result: ToolResult<unknown> },
): void {
  sql.exec(
    `INSERT OR REPLACE INTO write_keys (caller, key, tool, at, result) VALUES (?, ?, ?, ?, ?)`,
    callerKey(first.caller),
    first.key,
    first.tool,
    first.at,
    JSON.stringify(first.result),
  );
}

/** Drop each key forgotten by `at`, so the table holds only what is remembered. */
export function forgetOldKeys(sql: SqlStorage, at: number): void {
  sql.exec(`DELETE FROM write_keys WHERE at <= ?`, keysForgottenBy(at));
}

/** Whether any key is still remembered, so there is something left to forget. */
export function holdsKeys(sql: SqlStorage): boolean {
  return sql.exec(`SELECT 1 FROM write_keys LIMIT 1`).toArray().length > 0;
}

/**
 * Keys are remembered per caller. A Connection is told apart by its name until Connections
 * have ids of their own (section 7.2).
 */
function callerKey(caller: Caller): string {
  return "name" in caller ? `${caller.kind}:${caller.name}` : caller.kind;
}
