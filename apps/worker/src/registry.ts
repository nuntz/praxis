import {
  type Caller,
  failure,
  isToolName,
  parseToolInput,
  type ToolInput,
  type ToolName,
  type ToolOutput,
  type ToolResult,
  tools,
} from "@praxis/domain";

/** What a Context tool is given to run. It never reads the real clock: `arrivedAt` is the time. */
export type ToolCall<N extends ToolName> = {
  caller: Caller;
  input: ToolInput<N>;
  /** When the call arrived, in milliseconds since the epoch. */
  arrivedAt: number;
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
 * input against the tool's schema, and runs the tool as one transaction.
 */
export function dispatch(
  handlers: Handlers,
  storage: DurableObjectStorage,
  request: ToolRequest,
): ToolResult<unknown> {
  const { caller, tool } = request;
  if (!isToolName(tool) || tools[tool].offered[caller.kind] !== "yes") {
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
  return storage.transactionSync(() =>
    handler({
      caller: request.caller,
      input: parsed.input,
      arrivedAt: request.arrivedAt,
      sql: storage.sql,
    }),
  );
}
