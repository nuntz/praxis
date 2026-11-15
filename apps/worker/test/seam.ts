import { env } from "cloudflare:workers";
import type { Caller, ToolName, ToolOutput, ToolResult } from "@praxis/domain";

export const hand: Caller = { kind: "hand" };
export const agent: Caller = { kind: "agent" };
export const clock: Caller = { kind: "clock" };
export const connection: Caller = { kind: "connection", name: "Claude Code" };
export const readOnlyConnection: Caller = { kind: "read_only_connection", name: "Reader" };
export const everyCaller = [hand, agent, clock, connection, readOnlyConnection];

/**
 * A fresh Context object, reached the way the Worker reaches one: through the registry, as a
 * named caller, at a time the test sets.
 */
export function newContext(startAt = "2026-11-15T09:00:00.000Z") {
  const stub = env.CONTEXT.get(env.CONTEXT.newUniqueId());
  let now = Date.parse(startAt);

  return {
    advance(ms: number) {
      now += ms;
    },
    call<N extends ToolName>(caller: Caller, tool: N, input: unknown) {
      return stub.call({ caller, tool, input, arrivedAt: now }) as Promise<
        ToolResult<ToolOutput[N]>
      >;
    },
    /** For calling a tool the registry may not have, by any name. */
    callAny(caller: Caller, tool: string, input: unknown) {
      return stub.call({ caller, tool, input, arrivedAt: now }) as Promise<ToolResult<unknown>>;
    },
  };
}

/** The value of a success, failing the test on an error. */
export function value<T>(result: ToolResult<T>): T {
  if (!result.ok)
    throw new Error(`Expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}
