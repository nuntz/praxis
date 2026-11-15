import { DurableObject } from "cloudflare:workers";
import type { ToolResult } from "@praxis/domain";
import { dispatch, type Handlers, type ToolRequest } from "./registry.ts";
import { createTables } from "./tables.ts";
import { entryTools } from "./tools/entries.ts";

const handlers: Handlers = { ...entryTools };

/** One Context: its Journal and everything else it holds, on its own SQLite (ADR 0006). */
export class ContextObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => createTables(ctx.storage.sql));
  }

  /** Call a Context tool through the registry. `arrivedAt` is when the call reached the Worker. */
  async call(request: ToolRequest): Promise<ToolResult<unknown>> {
    return dispatch(handlers, this.ctx.storage, request);
  }
}
