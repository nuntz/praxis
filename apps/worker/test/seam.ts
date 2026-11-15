import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Caller, ToolName, ToolOutput, ToolResult } from "@praxis/domain";
import { throughOracle } from "./oracle.ts";

export const hand: Caller = { kind: "hand" };
export const agent: Caller = { kind: "agent" };
export const clock: Caller = { kind: "clock" };
export const connection: Caller = { kind: "connection", name: "Claude Code" };
export const readOnlyConnection: Caller = { kind: "read_only_connection", name: "Reader" };
export const everyCaller = [hand, agent, clock, connection, readOnlyConnection];

export const DAY = 24 * 60 * 60 * 1000;

/**
 * A fresh Context object, reached the way the Worker reaches one: through the registry, as a
 * named caller, at a time the test sets. Every call goes through the oracle.
 */
export function newContext(startAt = "2026-11-15T09:00:00.000Z") {
  const stub = env.CONTEXT.get(env.CONTEXT.newUniqueId());
  let now = Date.parse(startAt);

  const callAny = (caller: Caller, tool: string, input: unknown) =>
    throughOracle(stub, { caller, tool, input, arrivedAt: now });

  return {
    /** Move the Context's clock on. */
    advance(ms: number) {
      now += ms;
    },
    /** Fire the Context's alarm at the time the test has set. */
    fireAlarm() {
      return stub.wake(now);
    },
    /**
     * Run the alarm the platform has scheduled, as the platform would, by the real clock.
     * False when none is scheduled.
     */
    runScheduledAlarm() {
      return runDurableObjectAlarm(stub);
    },
    call<N extends ToolName>(caller: Caller, tool: N, input: unknown) {
      return callAny(caller, tool, input) as Promise<ToolResult<ToolOutput[N]>>;
    },
    /** For calling a tool the registry may not have, by any name. */
    callAny,
  };
}

/** The value of a success, failing the test on an error. */
export function value<T>(result: ToolResult<T>): T {
  if (!result.ok)
    throw new Error(`Expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}
