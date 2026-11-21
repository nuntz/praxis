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
  /**
   * The person's words in the Message the Agent's Run answers, for a call the Agent makes in one,
   * and null for any other call: an Entry the Agent records of them is the person's (section 3.2).
   */
  wordsAnswered: string | null;
};

/**
 * The Context tools the Context's object runs itself, after the same checks, since they cannot run
 * inside one transaction of its SQL: `list_notices` asks the Deployment object what it answers,
 * `search` asks the meaning index, `rebuild_search_index` sets the index to be built afresh, and
 * `clear_conversation` drops the runtime's record and opens it afresh: neither changes a record
 * nor leaves an Effect.
 */
export type ObjectToolName =
  | "list_notices"
  | "search"
  | "rebuild_search_index"
  | "clear_conversation";

const OBJECT_TOOLS: readonly string[] = [
  "list_notices",
  "search",
  "rebuild_search_index",
  "clear_conversation",
];

export function isObjectTool(name: string): name is ObjectToolName {
  return OBJECT_TOOLS.includes(name);
}

export type Handlers = {
  [N in Exclude<ToolName, ObjectToolName>]: (call: ToolCall<N>) => ToolResult<ToolOutput[N]>;
};

export type ToolRequest = {
  caller: Caller;
  tool: string;
  input: unknown;
  arrivedAt: number;
  /**
   * The Device the screen called from, by the id its browser keeps, for a Deployment tool: that
   * Device, if listed, was seen then (section 8.10).
   */
  device?: string;
  /** For a call the Agent makes in a Run, the person's words in the Message it answers. */
  wordsAnswered?: string;
};

/**
 * A call let in to a Context tool: one its caller is offered, with input its schema takes. Every
 * Context tool is let in by `admit`, whether `dispatch` runs it or the Context's object does.
 */
export type Admitted = { [N in ToolName]: { tool: N; input: ToolInput<N> } }[ToolName];

/** Refuse a tool the caller is not offered, and check the input against the tool's schema. */
export function admit(request: ToolRequest): ToolResult<Admitted> {
  const { caller, tool } = request;
  if (!isToolName(tool) || !isOffered(tool, caller.kind)) {
    return failure("not_offered", `The tool ${tool} is not offered to this caller.`);
  }
  const parsed = parseToolInput(tool, request.input);
  if (!parsed.ok) return parsed;
  return success({ tool, input: parsed.input } as Admitted);
}

/**
 * The one way into a Context's tools but those its object runs itself. It lets the call in,
 * and runs the tool as one transaction. For a write it also answers a repeated key with the first
 * result, and puts the Effects in the change log.
 */
export function dispatch(
  handlers: Handlers,
  storage: DurableObjectStorage,
  request: ToolRequest,
): ToolResult<unknown> {
  const admitted = admit(request);
  if (!admitted.ok) return admitted;
  const { tool, input } = admitted.value;
  if (isObjectTool(tool)) throw new Error(`${tool} is run by the Context's object, not dispatched`);
  return runTool(tool, input, handlers, storage, request);
}

function runTool<N extends Exclude<ToolName, ObjectToolName>>(
  tool: N,
  input: ToolInput<N>,
  handlers: Handlers,
  storage: DurableObjectStorage,
  request: ToolRequest,
): ToolResult<unknown> {
  const handler = handlers[tool] as (call: ToolCall<N>) => ToolResult<ToolOutput[N]>;
  const call: ToolCall<N> = {
    caller: request.caller,
    input,
    arrivedAt: request.arrivedAt,
    today: dayIn(request.arrivedAt, timeZoneOf(storage.sql)),
    sql: storage.sql,
    wordsAnswered: request.wordsAnswered ?? null,
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
