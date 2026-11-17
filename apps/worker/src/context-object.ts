import { DurableObject } from "cloudflare:workers";
import {
  type Caller,
  type Change,
  type ContextMade,
  isToolName,
  isWrite,
  type LiveMessage,
  NOTHING_GOES_UP,
  type ToolResult,
} from "@praxis/domain";
import { arrivalTime, startTimer } from "./arrival.ts";
import {
  appendChange,
  changesAfter,
  encodeCursor,
  holdsChanges,
  lastChange,
  pruneChanges,
} from "./change-log.ts";
import { forgetOldKeys, holdsKeys } from "./keys.ts";
import { logCall } from "./log.ts";
import { dispatch, type Handlers, type ToolRequest } from "./registry.ts";
import { contextEffect, makeContext, renameContext } from "./settings.ts";
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
function liveMessage(items: Change[], last: number): string {
  const message: LiveMessage = { kind: "changes", items, cursor: encodeCursor(last) };
  return JSON.stringify(message);
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

/** One Context: its Journal and everything else it holds, on its own SQLite (ADR 0006). */
export class ContextObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => createTables(ctx.storage.sql));
  }

  /**
   * Make this Context with its name and time zone. The Deployment object calls it on
   * `create_context`, before it lists the Context, so no request reaches a Context not yet made.
   * The Context's id is its object's.
   */
  async make(made: ContextMade): Promise<void> {
    makeContext(this.ctx.storage.sql, this.ctx.id.toString(), made);
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

  /** Call a Context tool through the registry. `arrivedAt` is when the call reached the Worker. */
  async call(request: ToolRequest): Promise<ToolResult<unknown>> {
    const elapsed = startTimer();
    const before = lastChange(this.ctx.storage.sql);
    const result = dispatch(handlers, this.ctx.storage, request);
    const tool = isToolName(request.tool) ? request.tool : null;
    logCall({ tool, write: isWrite(request.tool) }, result, elapsed());
    if (isWrite(request.tool)) await this.afterWrite(before);
    return result;
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
    const message = liveMessage(items, last);
    for (const channel of this.ctx.getWebSockets()) {
      try {
        channel.send(message);
      } catch {
        // A channel closing as this was sent; the screen catches up from list_changes.
      }
    }
  }

  /**
   * Open the live channel (section 9.5): a WebSocket the object holds through hibernation, so an
   * idle one costs nothing. The Worker has already said which Context it is and that the person
   * is signed in. It first says where the change log stands, then carries each change.
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
    held.send(liveMessage([], lastChange(this.ctx.storage.sql)));
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

  private async keepAlarm(): Promise<void> {
    const storage = this.ctx.storage;
    const somethingToDo = holdsKeys(storage.sql) || holdsChanges(storage.sql);
    if (somethingToDo && (await storage.getAlarm()) === null) {
      await storage.setAlarm(arrivalTime() + ALARM_GAP);
    }
  }
}
