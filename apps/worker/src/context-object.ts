import { DurableObject } from "cloudflare:workers";
import type { Wake } from "@earendil-works/pi-durable";
import {
  type Caller,
  type Change,
  type ContextMade,
  type ConversationToolInput,
  type ConversationToolName,
  failure,
  isConversationToolName,
  isToolName,
  isWrite,
  type LiveMessage,
  NOTHING_GOES_UP,
  type NoAgent,
  offeredConversationTool,
  parseConversationToolInput,
  refusal,
  success,
  type ToolResult,
} from "@praxis/domain";
import { type Bearings, ContextAgent } from "./agent.ts";
import { arrivalTime, startTimer } from "./arrival.ts";
import {
  appendChange,
  changesAfter,
  encodeCursor,
  holdsChanges,
  lastChange,
  pruneChanges,
} from "./change-log.ts";
import { forgetOldKeys, holdsKeys, rememberKey, repeatedKey } from "./keys.ts";
import { logCall } from "./log.ts";
import type { AgentModel } from "./model.ts";
import { dispatch, type Handlers, type ToolRequest } from "./registry.ts";
import { deploymentOf } from "./routing.ts";
import { runsNotEnded } from "./run-rows.ts";
import {
  contextEffect,
  deploymentOfContext,
  makeContext,
  readSettings,
  renameContext,
} from "./settings.ts";
import { createTables } from "./tables.ts";
import { changeTools } from "./tools/changes.ts";
import { entryTools } from "./tools/entries.ts";
import { personTools } from "./tools/persons.ts";
import { projectTools } from "./tools/projects.ts";
import { recurrenceTools } from "./tools/recurrences.ts";
import { settingsTools } from "./tools/settings.ts";
import { taskTools } from "./tools/tasks.ts";
import { waitTools } from "./tools/waits.ts";

/** A message of the live channel: these changes, and the cursor standing after `last`. */
function changesMessage(items: Change[], last: number): LiveMessage {
  return { kind: "changes", items, cursor: encodeCursor(last) };
}

const handlers: Handlers = {
  ...entryTools,
  ...taskTools,
  ...waitTools,
  ...recurrenceTools,
  ...projectTools,
  ...personTools,
  ...settingsTools,
  ...changeTools,
};

/** How long the alarm sleeps between wakes while it has something to do. */
const ALARM_GAP = 24 * 60 * 60 * 1000;

/**
 * How soon the alarm comes back while the Agent is working, so an object evicted mid-Run is woken
 * to finish it.
 */
const RUN_HEARTBEAT = 60 * 1000;

const AGENT: Caller = { kind: "agent" };

/** Why a Message is refused when there is no Agent: the person mends it in the configuration. */
const NO_AGENT: Record<NoAgent, string> = {
  no_key:
    "There is no Agent in this Deployment: its configuration gives no key for the model. Giving one is a change to the configuration and a deploy.",
  model_has_no_price:
    "There is no Agent in this Deployment: its configuration names a model Praxis ships no price for, so no Run could be counted. Naming another is a change to the configuration and a deploy.",
};

/**
 * The Context object, given where its Agent's model comes from: the Deployment's configuration, or
 * a scripted model in tests (section 13). Without a model, `modelOf` says why there is no Agent.
 */
export function contextObject(modelOf: (env: Env) => AgentModel | NoAgent) {
  /** One Context: its Journal and everything else it holds, on its own SQLite (ADR 0006). */
  return class ContextObject extends DurableObject<Env> {
    /** The Agent, opened on first use: most requests never need it. */
    #agent: ContextAgent | NoAgent | undefined;
    /** What the Agent's runtime last said it needs a process for. */
    #agentWake: Wake = { active: false };
    /**
     * How far the clock requests arrive by stands from the platform's: none when deployed, and
     * wherever a test has set it. The Agent's calls arrive by it.
     */
    #clockSkew = 0;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      ctx.blockConcurrencyWhile(async () => createTables(ctx.storage.sql));
    }

    /**
     * Make this Context with its name and time zone. The Deployment object calls it on
     * `create_context`, before it lists the Context, so no request reaches a Context not yet
     * made. The Context's id is its object's, and it keeps the id of the Deployment object.
     */
    async make(made: ContextMade, deployment: string): Promise<void> {
      makeContext(this.ctx.storage.sql, this.ctx.id.toString(), made, deployment);
    }

    /**
     * Give this Context the name the Deployment object lists it by, on `rename_context`. A change
     * to its settings is an Effect on it, so the rename goes in its change log with the caller.
     */
    async rename(name: string, by: { caller: Caller; at: number }): Promise<void> {
      const sql = this.ctx.storage.sql;
      const before = lastChange(sql);
      this.ctx.storage.transactionSync(() => {
        renameContext(sql, name);
        appendChange(sql, {
          at: by.at,
          caller: by.caller,
          tool: "rename_context",
          effects: [contextEffect(sql)],
        });
      });
      await this.afterWrite(before);
    }

    /**
     * Call a Context tool through the registry, or a Conversation tool. `arrivedAt` is when the
     * call reached the Worker.
     */
    async call(request: ToolRequest): Promise<ToolResult<unknown>> {
      if (isConversationToolName(request.tool)) return this.converse(request.tool, request);
      const elapsed = startTimer();
      const before = lastChange(this.ctx.storage.sql);
      const result = dispatch(handlers, this.ctx.storage, request);
      const tool = isToolName(request.tool) ? request.tool : null;
      logCall({ tool, write: isWrite(request.tool) }, result, elapsed());
      if (isWrite(request.tool)) await this.afterWrite(before);
      return result;
    }

    /**
     * A Conversation tool (section 4.12), offered to the person's hand only. It returns no
     * Effects and writes nothing to the change log: what a Run changes is reported by the
     * Context tools it calls.
     */
    private async converse(
      tool: ConversationToolName,
      request: ToolRequest,
    ): Promise<ToolResult<unknown>> {
      const elapsed = startTimer();
      const result = offeredConversationTool(request.caller)
        ? await this.runConversationTool(tool, request)
        : failure("not_offered", `The tool ${tool} is not offered to this caller.`);
      logCall({ tool, write: false }, result, elapsed());
      return result;
    }

    private async runConversationTool(
      tool: ConversationToolName,
      request: ToolRequest,
    ): Promise<ToolResult<unknown>> {
      const parsed = parseConversationToolInput(tool, request.input);
      if (!parsed.ok) return parsed;
      const agent = this.agent();
      if (tool === "list_messages") {
        const { cursor } = parsed.input as ConversationToolInput<"list_messages">;
        if (typeof agent === "string") return success({ items: [], next_cursor: null, agent });
        return success(await agent.messages(this.ctx.storage, cursor));
      }
      const input = parsed.input as ConversationToolInput<"send_message">;
      if (typeof agent === "string") return refusal(NO_AGENT[agent], []);
      const sql = this.ctx.storage.sql;
      const { caller, arrivedAt } = request;
      const keyed = { caller, key: input.key, tool, at: arrivedAt };
      const repeated = repeatedKey(sql, keyed);
      if (repeated) return repeated;
      // The Agent's calls are timed by the clock the caller's requests arrive by.
      this.#clockSkew = arrivedAt - arrivalTime();
      const message = await agent.send(
        this.ctx.storage,
        { words: input.words, spoken: input.spoken ?? false, at: arrivedAt },
        await this.bearings(arrivedAt),
      );
      const result = success({ message });
      if (input.key !== undefined) rememberKey(sql, { ...keyed, key: input.key, result });
      return result;
    }

    /**
     * What the Agent is told at the start of a Run: today, this Context's name, and the other
     * Contexts' names, which this object asks the Deployment object for (section 5.2).
     */
    private async bearings(at: number): Promise<Bearings> {
      const settings = readSettings(this.ctx.storage.sql, at);
      const kept = deploymentOfContext(this.ctx.storage.sql);
      const deployment =
        kept === null
          ? deploymentOf(this.env)
          : this.env.DEPLOYMENT.get(this.env.DEPLOYMENT.idFromString(kept));
      const otherContexts = await deployment.otherContextNames(this.ctx.id.toString());
      return { today: settings.today, context: settings.name, otherContexts };
    }

    /** The Agent of this Context, or why the Deployment has none. */
    private agent(): ContextAgent | NoAgent {
      if (this.#agent !== undefined) return this.#agent;
      const model = modelOf(this.env);
      this.#agent =
        typeof model === "string"
          ? model
          : new ContextAgent(
              {
                call: (tool, input) => this.callAsAgent(tool, input),
                sql: this.ctx.storage.sql,
                send: (message) => this.send(message),
                arm: (wake) => {
                  this.#agentWake = wake;
                  return this.keepAlarm();
                },
              },
              model,
            );
      return this.#agent;
    }

    /** A call from the Agent in a Run, through the same registry as every other caller. */
    private callAsAgent(tool: string, input: unknown) {
      const sql = this.ctx.storage.sql;
      const arrivedAt = arrivalTime() + this.#clockSkew;
      const elapsed = startTimer();
      const before = lastChange(sql);
      const result = dispatch(handlers, this.ctx.storage, {
        caller: AGENT,
        tool,
        input,
        arrivedAt,
      });
      logCall({ tool, write: isWrite(tool) }, result, elapsed());
      const after = lastChange(sql);
      if (after !== before) void this.afterWrite(before);
      return { result, change: after !== before ? after : null };
    }

    /** After a write: carry what it added to the log live, and keep the alarm that prunes it. */
    private async afterWrite(before: number): Promise<void> {
      this.carryChangesAfter(before);
      await this.keepAlarm();
    }

    /**
     * Carry what the change log gained since `before` down every live channel open on this
     * Context. A write that changed nothing, failed or repeated a key gained it nothing.
     */
    private carryChangesAfter(before: number): void {
      const sql = this.ctx.storage.sql;
      if (lastChange(sql) === before) return;
      // A single write adds one change, so the log is read whole from `before`.
      const { items, last } = changesAfter(sql, before, Number.MAX_SAFE_INTEGER);
      this.send(changesMessage(items, last));
    }

    /** Carry a message down every live channel open on this Context. */
    private send(message: LiveMessage): void {
      const text = JSON.stringify(message);
      for (const channel of this.ctx.getWebSockets()) {
        try {
          channel.send(text);
        } catch {
          // A channel closing as this was sent; the screen catches up when it opens another.
        }
      }
    }

    /**
     * Open the live channel (section 9.5): a WebSocket the object holds through hibernation, so
     * an idle one costs nothing. The Worker has already said which Context it is and that the
     * person is signed in. It first says where the change log stands, then carries each change,
     * and the Agent's answer as it is written.
     */
    async fetch(request: Request): Promise<Response> {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("The live channel is a WebSocket.", {
          status: 426,
          headers: { upgrade: "websocket" },
        });
      }
      const { 0: screen, 1: held } = new WebSocketPair();
      this.ctx.acceptWebSocket(held);
      held.send(JSON.stringify(changesMessage([], lastChange(this.ctx.storage.sql))));
      return new Response(null, { status: 101, webSocket: screen });
    }

    /** Nothing travels up the live channel: whatever is sent closes it, and is not acted on. */
    async webSocketMessage(channel: WebSocket): Promise<void> {
      channel.close(NOTHING_GOES_UP, "Nothing is sent up the live channel: call a tool.");
    }

    /** The screen closed its channel, by switching Context or going away: close this end too. */
    async webSocketClose(channel: WebSocket): Promise<void> {
      try {
        channel.close(1000, "Closed by the screen");
      } catch {
        // Already closed by the platform's own reply.
      }
    }

    /** The platform fires the alarm by the real clock. Tests call `wake` themselves. */
    async alarm(): Promise<void> {
      this.wake(arrivalTime());
      // A Run a lost instance left going, or one the runtime is waiting to retry, is taken up.
      const agent = this.agent();
      if (
        typeof agent !== "string" &&
        (this.#agentWake.active || runsNotEnded(this.ctx.storage.sql).length > 0)
      ) {
        await agent.wake(this.ctx.storage);
      }
      await this.keepAlarm();
    }

    /**
     * Everything the Context's clock does, as at `at`: for now, forgetting keys past 30 days and
     * pruning the change log at 90.
     */
    wake(at: number): void {
      const sql = this.ctx.storage.sql;
      this.ctx.storage.transactionSync(() => {
        forgetOldKeys(sql, at);
        pruneChanges(sql, at);
      });
    }

    /**
     * Wait until every Run in this Context has ended and its record says how. For tests, which
     * cannot see a Run end otherwise but on the live channel.
     */
    async runsEnded(): Promise<void> {
      const agent = this.agent();
      if (typeof agent !== "string") await agent.runsEnded(this.ctx.storage);
    }

    /**
     * Keep the alarm armed for the earliest thing this object has to do: the Agent's runtime,
     * while it works or sleeps, and the daily pruning while there is something to prune.
     */
    private async keepAlarm(): Promise<void> {
      const storage = this.ctx.storage;
      const now = arrivalTime();
      const wanted: number[] = [];
      if (holdsKeys(storage.sql) || holdsChanges(storage.sql)) wanted.push(now + ALARM_GAP);
      if (this.#agentWake.active) wanted.push(now + RUN_HEARTBEAT);
      if (this.#agentWake.at !== undefined) wanted.push(this.#agentWake.at);
      const set = await storage.getAlarm();
      if (wanted.length === 0) return;
      const earliest = Math.min(...wanted);
      // The daily wake is kept as it was set; only something sooner moves it.
      if (set === null || earliest < set) await storage.setAlarm(earliest);
    }
  };
}
