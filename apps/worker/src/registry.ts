import {
  type Caller,
  type Day,
  dayIn,
  failure,
  isOffered,
  isToolName,
  isWrite,
  parseToolInput,
  success,
  type ToolInput,
  type ToolName,
  type ToolOutput,
  type ToolResult,
  type WriteName,
  type Written,
} from "@praxis/domain";
import { appendChange } from "./change-log.ts";
import { lapseHeldChanges } from "./held-change-rows.ts";
import { rememberKey, repeatedKey } from "./keys.ts";
import { timeZoneOf } from "./settings.ts";

/** What a Context tool is given to run. It never reads the real clock: `arrivedAt` is the time. */
export type ToolCall<N extends ToolName> = {
  caller: Caller;
  input: ToolInput<N>;
  /** When the call arrived, in milliseconds since the epoch. */
  arrivedAt: number;
  /** The day the call arrived on in the Context's time zone, by which a Task's state is read. */
  today: Day;
  sql: SqlStorage;
};

export type Handlers = {
  [N in ToolName]: (call: ToolCall<N>) => ToolResult<ToolOutput[N]>;
};

export type ToolRequest = {
  caller: Caller;
  tool: string;
  input: unknown;
  arrivedAt: number;
};

/**
 * The one way into a Context's tools. It refuses a tool the caller is not offered, checks the
 * input against the tool's schema, and runs the tool as one transaction. For a write it also
 * answers a repeated key with the first result, and puts the Effects in the change log.
 */
export function dispatch(
  handlers: Handlers,
  storage: DurableObjectStorage,
  request: ToolRequest,
): ToolResult<unknown> {
  const { caller, tool } = request;
  if (!isToolName(tool) || !isOffered(tool, caller.kind)) {
    return failure("not_offered", `The tool ${tool} is not offered to this caller.`);
  }
  return runTool(tool, handlers, storage, request);
}

function runTool<N extends ToolName>(
  tool: N,
  handlers: Handlers,
  storage: DurableObjectStorage,
  request: ToolRequest,
): ToolResult<unknown> {
  const parsed = parseToolInput(tool, request.input);
  if (!parsed.ok) return parsed;
  const handler = handlers[tool] as (call: ToolCall<N>) => ToolResult<ToolOutput[N]>;
  const call: ToolCall<N> = {
    caller: request.caller,
    input: parsed.input,
    arrivedAt: request.arrivedAt,
    today: dayIn(request.arrivedAt, timeZoneOf(storage.sql)),
    sql: storage.sql,
  };
  return storage.transactionSync(() =>
    isWrite(tool)
      ? runWrite(
          tool,
          handler as unknown as (call: ToolCall<WriteName>) => ToolResult<Written<unknown>>,
          call as unknown as ToolCall<WriteName>,
        )
      : handler(call),
  );
}

/**
 * A write's result with the Held Changes it lapsed among its Effects, by rule: a change to an
 * Entry lapses each one waiting on it, whoever made the change (section 4.7).
 */
function withLapses(
  sql: SqlStorage,
  result: ToolResult<Written<unknown>>,
): ToolResult<Written<unknown>> {
  if (!result.ok || result.value.effects.length === 0) return result;
  const lapsed = lapseHeldChanges(sql);
  if (lapsed.length === 0) return result;
  return success({ ...result.value, effects: [...result.value.effects, ...lapsed] });
}

function runWrite(
  tool: WriteName,
  handler: (call: ToolCall<WriteName>) => ToolResult<Written<unknown>>,
  call: ToolCall<WriteName>,
): ToolResult<unknown> {
  const { sql, caller, arrivedAt } = call;
  const key = call.input.key;
  const repeated = repeatedKey(sql, { caller, key, tool, at: arrivedAt });
  if (repeated) return repeated;

  const result = withLapses(sql, handler(call));
  if (result.ok && result.value.effects.length > 0) {
    appendChange(sql, { at: arrivedAt, caller, tool, effects: result.value.effects });
  }
  if (key !== undefined) rememberKey(sql, { caller, key, tool, at: arrivedAt, result });
  return result;
}
