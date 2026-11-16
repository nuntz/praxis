import { DurableObject } from "cloudflare:workers";
import {
  type Caller,
  type ContextMade,
  isToolName,
  isWrite,
  type ToolResult,
} from "@praxis/domain";
import { arrivalTime, startTimer } from "./arrival.ts";
import { appendChange } from "./change-log.ts";
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
    this.ctx.storage.transactionSync(() => {
      renameContext(sql, name);
      appendChange(sql, {
        at: by.at,
        caller: by.caller,
        tool: "rename_context",
        effects: [contextEffect(sql)],
      });
    });
  }

  /** Call a Context tool through the registry. `arrivedAt` is when the call reached the Worker. */
  async call(request: ToolRequest): Promise<ToolResult<unknown>> {
    const elapsed = startTimer();
    const result = dispatch(handlers, this.ctx.storage, request);
    const tool = isToolName(request.tool) ? request.tool : null;
    logCall({ tool, write: isWrite(request.tool) }, result, elapsed());
    if (isWrite(request.tool)) await this.keepAlarm();
    return result;
  }

  /** The platform fires the alarm by the real clock. Tests call `wake` themselves. */
  async alarm(): Promise<void> {
    this.wake(arrivalTime());
    await this.keepAlarm();
  }

  /** Everything the Context's clock does, as at `at`: for now, forgetting keys past 30 days. */
  wake(at: number): void {
    forgetOldKeys(this.ctx.storage.sql, at);
  }

  private async keepAlarm(): Promise<void> {
    const storage = this.ctx.storage;
    if (holdsKeys(storage.sql) && (await storage.getAlarm()) === null) {
      await storage.setAlarm(arrivalTime() + ALARM_GAP);
    }
  }
}
