import {
  type ConnectionCall,
  type ConnectionCaller,
  connectionCallsPrunedBy,
  type ErrorCode,
  instantToIso,
  isToolName,
  type Page,
  recordsReturned,
  type ToolName,
  type ToolOutput,
  type ToolResult,
  toolKind,
} from "@praxis/domain";
import { newestFirst } from "./newest-first.ts";

/**
 * Keep one call a Connection made: the tool, when it arrived, its result code and how many records
 * came back. A name that is no tool is kept as none, since it is text the Connection sent, and
 * nothing it sent or was given is kept.
 */
export function keepConnectionCall(
  sql: SqlStorage,
  call: { caller: ConnectionCaller; tool: string; at: number; result: ToolResult<unknown> },
): void {
  const tool = toolKind(call.tool) === null ? null : call.tool;
  const { result } = call;
  // A Connection is offered no Conversation tool, so only a Context tool answers it.
  const records =
    result.ok && isToolName(call.tool)
      ? recordsReturned(call.tool, result.value as ToolOutput[ToolName])
      : 0;
  sql.exec(
    `INSERT INTO connection_calls (at, caller_kind, connection_id, connection_name, tool, result, records)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    call.at,
    call.caller.kind,
    call.caller.id,
    call.caller.name,
    tool,
    result.ok ? "ok" : result.error.code,
    records,
  );
}

/**
 * One page of the calls the Connections made, newest first: of one Connection, by its id, or of
 * any, and of the tools that read only, or of every call.
 */
export function connectionCallsPage(
  sql: SqlStorage,
  cursor: string | undefined,
  narrowed: { connection?: string; readsOnly?: boolean } = {},
): ToolResult<Page<ConnectionCall>> {
  const { connection, readsOnly = false } = narrowed;
  const page = newestFirst(
    "connection_calls",
    cursor,
    (before) =>
      connection === undefined
        ? sql.exec<CallRow>(
            `SELECT * FROM connection_calls WHERE seq < ? ORDER BY seq DESC`,
            before,
          )
        : sql.exec<CallRow>(
            `SELECT * FROM connection_calls WHERE seq < ? AND connection_id = ? ORDER BY seq DESC`,
            before,
            connection,
          ),
    // A name that is no tool read nothing.
    (row) => !readsOnly || (row.tool !== null && toolKind(row.tool) === "read"),
  );
  if (!page.ok) return page;
  return {
    ok: true,
    value: { items: page.value.rows.map(toConnectionCall), next_cursor: page.value.next_cursor },
  };
}

/** Drop each call 90 days old by `at` (section 10.5). */
export function pruneConnectionCalls(sql: SqlStorage, at: number): void {
  sql.exec(`DELETE FROM connection_calls WHERE at <= ?`, connectionCallsPrunedBy(at));
}

/** Whether any call is kept, so there is something left to prune. */
export function holdsConnectionCalls(sql: SqlStorage): boolean {
  return sql.exec(`SELECT 1 FROM connection_calls LIMIT 1`).toArray().length > 0;
}

type CallRow = {
  seq: number;
  at: number;
  caller_kind: ConnectionCaller["kind"];
  connection_id: string;
  connection_name: string;
  tool: string | null;
  result: "ok" | ErrorCode;
  records: number;
};

function toConnectionCall(row: CallRow): ConnectionCall {
  return {
    at: instantToIso(row.at),
    caller: { kind: row.caller_kind, id: row.connection_id, name: row.connection_name },
    tool: row.tool,
    kind: row.tool === null ? null : toolKind(row.tool),
    result: row.result,
    records: row.records,
  };
}
