import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  type Accent,
  type Caller,
  type ContextMade,
  type DeploymentToolName,
  type DeploymentToolOutput,
  type Held,
  isHeld,
  type LiveChanges,
  type LiveMessage,
  type ToolName,
  type ToolOutput,
  type ToolResult,
} from "@praxis/domain";
import { reachContext } from "../src/routing.ts";
import { throughDeploymentOracle, throughOracle, wakeThroughOracle } from "./oracle.ts";
import { addSteps, failingStep } from "./upgrade-faults.ts";

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
 * A fresh Deployment object, at a time the test sets, holding no Context until one is made, or
 * the one with an id a fixture laid an earlier release's tables in (test/dump.ts).
 * Its tools are called as a named caller, and a Context in it is reached the way the Worker
 * reaches one: the Deployment object says which object it is, and every call to that object
 * goes through the oracle. Tests in a file share storage, every binding's, and each file has its
 * own: so each makes its own objects by a fresh id, and a test of the bucket empties it first.
 */
export function newDeployment(startAt = "2026-11-15T09:00:00.000Z", existing?: string) {
  const id =
    existing === undefined ? env.DEPLOYMENT.newUniqueId() : env.DEPLOYMENT.idFromString(existing);
  // Taken afresh for each call: a stub held across an object woken again is broken.
  const deployment = () => env.DEPLOYMENT.get(id);
  const time = { now: Date.parse(startAt) };
  const contextOf = (id: string) => env.CONTEXT.get(env.CONTEXT.idFromString(id));
  // Every call goes through the oracle, which holds a write's reach into a Context to its Effects.
  const callAny = (caller: Caller, tool: string, input: unknown, device?: string) =>
    throughDeploymentOracle(deployment(), contextOf, {
      caller,
      tool,
      input,
      arrivedAt: time.now,
      ...(device === undefined ? {} : { device }),
    });

  return {
    /** The Deployment object's id. */
    id: id.toString(),
    /** Move the Deployment's clock on, and every Context's in it. */
    advance(ms: number) {
      time.now += ms;
    },
    call<N extends DeploymentToolName>(caller: Caller, tool: N, input: unknown) {
      return callAny(caller, tool, input) as Promise<ToolResult<DeploymentToolOutput[N]>>;
    },
    /** Call a Deployment tool as the hand from the screen on a Device, as its header names it. */
    callFrom<N extends DeploymentToolName>(device: string, tool: N, input: unknown) {
      return callAny(hand, tool, input, device) as Promise<ToolResult<DeploymentToolOutput[N]>>;
    },
    /** For calling a Deployment tool the registry may not have, by any name. */
    callAny,
    /** Make the daily Backup at the time the test has set, as the Worker's daily trigger asks. */
    backUp() {
      return deployment().backUp(time.now);
    },
    /**
     * Delete a Context's object for good as `delete_context` asks it to, with the Deployment object
     * never hearing it was done, as when the answer is lost on the way back.
     */
    deleteObjectUnheard(id: string) {
      return contextOf(id).deleteForGood();
    },
    /**
     * Call a Deployment tool past the oracle, for a call a test makes lose an answer on its way,
     * as a move whose Context took the unit and never said so: what changed is then not what the
     * call returned, which the oracle would rightly fail.
     */
    callUnjudged<N extends DeploymentToolName>(caller: Caller, tool: N, input: unknown) {
      return deployment().call({ caller, tool, input, arrivedAt: time.now }) as Promise<
        ToolResult<DeploymentToolOutput[N]>
      >;
    },
    /**
     * Have a Context's object take a unit out for a move as `move_record` asks it to, with the
     * Deployment object never hearing it was done, as when the answer is lost on the way back.
     */
    beginMoveUnheard(
      from: string,
      asked: { record: { kind: "entry" | "project"; id: string }; unit: string[]; to: string },
    ) {
      return contextOf(from).beginMove(
        { id: crypto.randomUUID(), ...asked },
        { caller: hand, at: time.now },
      );
    },
    /**
     * Fire a Context's alarm at the time the test has set, retired or not, as the platform fires
     * every object's: a retired Context is reached by no request.
     */
    fireAlarmOf(id: string) {
      return wakeThroughOracle(contextOf(id), time.now);
    },
    /**
     * Wake a Context's object again, as when it is evicted and the next thing reaches it, under the
     * release the test names: it climbs its ladder as it wakes (section 11).
     */
    wakeAgain(id: string) {
      return wakeAgain(contextOf(id));
    },
    /** Wake this Deployment's own object again, as `wakeAgain` does a Context's. */
    wakeItselfAgain() {
      return wakeAgain(deployment());
    },
    /**
     * Have a Context's object stuck on its upgrade (section 11), as when a step of the release
     * fails: it wakes again with one that does at the top of its ladder.
     */
    stickOnUpgrade(id: string) {
      addSteps(id, failingStep);
      return wakeAgain(contextOf(id));
    },
    /** The Context with this id, reached through the Deployment object as the Worker does. */
    context(id: string) {
      return contextHandle(time, () => reachContext(env, deployment(), id));
    },
  };
}

/**
 * Wake an object again: its instance is thrown away, its storage kept, and the next thing to reach
 * it makes a new one, which climbs its ladder as it wakes (section 11). The stub given is broken
 * from then on: reach the object by a new one.
 */
export async function wakeAgain(stub: DurableObjectStub): Promise<void> {
  try {
    await runInDurableObject(stub, (_, state) => state.abort("Woken again"));
  } catch {
    // Thrown by the abort itself.
  }
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
    listen: () => context.then((reached) => reached.listen()),
    runsEnded: () => context.then((reached) => reached.runsEnded()),
    meaningSettled: () => context.then((reached) => reached.meaningSettled()),
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
      return wakeThroughOracle(await stub(), time.now);
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
    /**
     * Wait until every Run in the Context has ended and its record says how: a Run goes on after
     * `send_message` answers, and the screen learns it ended on the live channel.
     */
    async runsEnded() {
      return (await stub()).runsEnded();
    },
    /**
     * Wait until the Context's meaning index has taken in what its writes queued, as far as it
     * goes: an Entry is found by meaning shortly after it is saved, not at once.
     */
    async meaningSettled() {
      return (await stub()).meaningSettled();
    },
    /** Open a live channel to the Context's object, as the screen does (section 9.5). */
    async listen() {
      return listenTo(await stub());
    },
  };
}

/**
 * A live channel open on a Context's object. What it carries is read in order with `next`, and
 * `closed` settles with the code and reason when the object closes it.
 */
async function listenTo(stub: DurableObjectStub) {
  const response = await stub.fetch("https://praxis.test/live", {
    headers: { upgrade: "websocket" },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error(`The object did not open a live channel: ${response.status}`);
  socket.accept();

  const arrived: LiveMessage[] = [];
  const waiting: ((message: LiveMessage) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as LiveMessage;
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else arrived.push(message);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.addEventListener("close", ({ code, reason }) => resolve({ code, reason })),
  );

  return {
    /** The next message the channel carries, once it arrives. */
    next(): Promise<LiveMessage> {
      const message = arrived.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve) => waiting.push(resolve));
    },
    /** The next message carrying changes, skipping what the Conversation sends. */
    async nextChanges(): Promise<LiveChanges> {
      for (;;) {
        const message = await this.next();
        if (message.kind === "changes") return message;
      }
    },
    /** Send something up the channel, which nothing is meant to travel. */
    send(data: string) {
      socket.send(data);
    },
    closed,
    close() {
      socket.close(1000, "Done");
    },
  };
}

/** The value of a success, failing the test on an error. */
export function value<T>(result: ToolResult<T>): T {
  if (!result.ok)
    throw new Error(`Expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/**
 * The value of a write that ran at once, failing the test on an error or on a Held Change left in
 * its place (section 4.7).
 */
export function atOnce<T extends object>(result: ToolResult<T>): Exclude<T, Held> {
  const got = value(result);
  if (isHeld(got)) throw new Error("Expected the change made at once, got a Held Change");
  return got as Exclude<T, Held>;
}

/** The Held Change a held call left, failing the test on an error or on a change made at once. */
export function left<T extends object>(result: ToolResult<T>): Held {
  const got = value(result);
  if (!isHeld(got)) throw new Error("Expected a Held Change left, got the change made at once");
  return got;
}
