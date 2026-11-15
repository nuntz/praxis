import { DurableObject } from "cloudflare:workers";
import { isToolName, isWrite, type ToolResult } from "@praxis/domain";
import { arrivalTime, startTimer } from "./arrival.ts";
import { forgetOldKeys, holdsKeys } from "./keys.ts";
import { dispatch, type Handlers, type ToolRequest } from "./registry.ts";
import { createTables } from "./tables.ts";
import { changeTools } from "./tools/changes.ts";
import { entryTools } from "./tools/entries.ts";
import { taskTools } from "./tools/tasks.ts";

const handlers: Handlers = { ...entryTools, ...taskTools, ...changeTools };

/** How long the alarm sleeps between wakes while it has something to do. */
const ALARM_GAP = 24 * 60 * 60 * 1000;

/** One Context: its Journal and everything else it holds, on its own SQLite (ADR 0006). */
export class ContextObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => createTables(ctx.storage.sql));
  }

  /** Call a Context tool through the registry. `arrivedAt` is when the call reached the Worker. */
  async call(request: ToolRequest): Promise<ToolResult<unknown>> {
    const elapsed = startTimer();
    const result = dispatch(handlers, this.ctx.storage, request);
    logCall(request.tool, result, elapsed());
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

/**
 * One line per call for the platform's logs. It carries only ids, tool names, result codes,
 * counts and timings, never words (section 2, principle 7).
 */
function logCall(tool: string, result: ToolResult<unknown>, ms: number): void {
  const line: Record<string, string | number> = {
    tool: isToolName(tool) ? tool : "unknown",
    result: result.ok ? "ok" : result.error.code,
    ms,
  };
  if (result.ok && isWrite(tool)) {
    line.effects = (result.value as { effects: unknown[] }).effects.length;
  }
  console.log(JSON.stringify(line));
}
