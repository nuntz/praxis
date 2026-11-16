import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type {
  Accent,
  Caller,
  ContextMade,
  DeploymentToolName,
  DeploymentToolOutput,
  ToolName,
  ToolOutput,
  ToolResult,
} from "@praxis/domain";
import { reachContext } from "../src/routing.ts";
import { throughDeploymentOracle, throughOracle } from "./oracle.ts";

export const hand: Caller = { kind: "hand" };
export const agent: Caller = { kind: "agent" };
export const clock: Caller = { kind: "clock" };
export const connection = { kind: "connection", id: "claude-code", name: "Claude Code" } as const;
export const readOnlyConnection = {
  kind: "read_only_connection",
  id: "reader",
  name: "Reader",
} as const;
export const everyCaller = [hand, agent, clock, connection, readOnlyConnection];

export const DAY = 24 * 60 * 60 * 1000;

/**
 * A fresh Deployment object, at a time the test sets, holding no Context until one is made.
 * Its tools are called as a named caller, and a Context in it is reached the way the Worker
 * reaches one: the Deployment object says which object it is, and every call to that object
 * goes through the oracle.
 */
export function newDeployment(startAt = "2026-11-15T09:00:00.000Z") {
  const stub = env.DEPLOYMENT.get(env.DEPLOYMENT.newUniqueId());
  const time = { now: Date.parse(startAt) };
  const contextOf = (id: string) => env.CONTEXT.get(env.CONTEXT.idFromString(id));
  // Every call goes through the oracle, which holds a write's reach into a Context to its Effects.
  const callAny = (caller: Caller, tool: string, input: unknown) =>
    throughDeploymentOracle(stub, contextOf, { caller, tool, input, arrivedAt: time.now });

  return {
    /** Move the Deployment's clock on, and every Context's in it. */
    advance(ms: number) {
      time.now += ms;
    },
    call<N extends DeploymentToolName>(caller: Caller, tool: N, input: unknown) {
      return callAny(caller, tool, input) as Promise<ToolResult<DeploymentToolOutput[N]>>;
    },
    /** For calling a Deployment tool the registry may not have, by any name. */
    callAny,
    /** The Context with this id, reached through the Deployment object as the Worker does. */
    context(id: string) {
      return contextHandle(time, () => reachContext(env, stub, id));
    },
  };
}

/**
 * A fresh Context, made by the hand in a Deployment of its own with this name and time zone, in
 * UTC unless one is given, and reached through the Deployment object.
 */
export function newContext(
  startAt = "2026-11-15T09:00:00.000Z",
  made: ContextMade & { accent?: Accent } = { name: "Personal", time_zone: "UTC" },
) {
  const deployment = newDeployment(startAt);
  const context = deployment
    .call(hand, "create_context", { accent: "blue", ...made })
    .then((result) => deployment.context(value(result).record.id));
  return {
    advance: deployment.advance,
    fireAlarm: () => context.then((reached) => reached.fireAlarm()),
    runScheduledAlarm: () => context.then((reached) => reached.runScheduledAlarm()),
    call<N extends ToolName>(caller: Caller, tool: N, input: unknown) {
      return context.then((reached) => reached.call(caller, tool, input));
    },
    callAny(caller: Caller, tool: string, input: unknown) {
      return context.then((reached) => reached.callAny(caller, tool, input));
    },
  };
}

/** A Context's object as a test reaches it, once the Deployment object has said which it is. */
function contextHandle(time: { now: number }, reach: () => ReturnType<typeof reachContext>) {
  const callAny = async (caller: Caller, tool: string, input: unknown) => {
    const reached = await reach();
    if (!reached.ok) return reached;
    return throughOracle(reached.value, { caller, tool, input, arrivedAt: time.now });
  };
  const stub = async () => {
    const reached = await reach();
    if (!reached.ok) throw new Error(`No Context reached: ${reached.error.message}`);
    return reached.value;
  };

  return {
    /** Fire the Context's alarm at the time the test has set. */
    async fireAlarm() {
      return (await stub()).wake(time.now);
    },
    /**
     * Run the alarm the platform has scheduled, as the platform would, by the real clock.
     * False when none is scheduled.
     */
    async runScheduledAlarm() {
      return runDurableObjectAlarm(await stub());
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
