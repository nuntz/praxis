import { DurableObject } from "cloudflare:workers";
import {
  type Connection,
  type DeploymentToolName,
  failure,
  isDeploymentToolName,
  isDeploymentWrite,
  offeredDeploymentTool,
  parseDeploymentToolInput,
  type ToolResult,
} from "@praxis/domain";
import { startTimer } from "./arrival.ts";
import { createDeploymentTables } from "./deployment-tables.ts";
import {
  callableConnection,
  type DeploymentCall,
  deploymentHandlers,
  isReachable,
} from "./deployment-tools.ts";
import { firstWithKey, rememberKey } from "./keys.ts";
import { logCall } from "./log.ts";
import type { ToolRequest } from "./registry.ts";

/**
 * The one object that belongs to the Deployment rather than to a Context (ADR 0006). It holds the
 * list of Contexts with their names and accents, and nothing from any Journal, and never reads
 * one.
 */
export class DeploymentObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => createDeploymentTables(ctx.storage.sql));
  }

  /**
   * Call a Deployment tool. They are offered to the person's hand only (section 4.11): any other
   * caller is refused before its input is read.
   */
  async call(request: ToolRequest): Promise<ToolResult<unknown>> {
    const elapsed = startTimer();
    const { caller, tool } = request;
    const known = isDeploymentToolName(tool) ? tool : null;
    const result =
      known && offeredDeploymentTool(caller)
        ? await this.run(known, request)
        : failure("not_offered", `The tool ${tool} is not offered to this caller.`);
    logCall({ tool: known, write: known !== null && isDeploymentWrite(known) }, result, elapsed());
    return result;
  }

  /** Whether a request may reach the Context with this id: it was made and is not retired. */
  async isReachable(id: string): Promise<boolean> {
    return isReachable(this.ctx.storage.sql, id);
  }

  /**
   * The Connection an MCP address names, asked on every call, so ending one or switching it to
   * reading only takes effect on the next (section 7.2). Null when it has ended, its Context is
   * retired, or there never was one: the caller cannot tell these apart.
   */
  async callableConnection(id: string): Promise<Connection | null> {
    return callableConnection(this.ctx.storage.sql, id);
  }

  private async run<N extends DeploymentToolName>(
    tool: N,
    request: ToolRequest,
  ): Promise<ToolResult<unknown>> {
    const parsed = parseDeploymentToolInput(tool, request.input);
    if (!parsed.ok) return parsed;
    const handler = deploymentHandlers[tool] as (
      call: DeploymentCall<N>,
    ) => Promise<ToolResult<unknown>>;
    const call: DeploymentCall<N> = {
      caller: request.caller,
      input: parsed.input,
      arrivedAt: request.arrivedAt,
      sql: this.ctx.storage.sql,
      env: this.env,
    };
    if (!isDeploymentWrite(tool)) return handler(call);
    // A write may wait on a Context's object, which would let another write in between. Writes run
    // one at a time, so a Context's object and this list are never left saying different things.
    return this.ctx.blockConcurrencyWhile(() => this.write(tool, handler, call));
  }

  /** Run a write, answering a repeated key with the first result, as a Context's object does. */
  private async write<N extends DeploymentToolName>(
    tool: N,
    handler: (call: DeploymentCall<N>) => Promise<ToolResult<unknown>>,
    call: DeploymentCall<N>,
  ): Promise<ToolResult<unknown>> {
    const { sql, caller, arrivedAt } = call;
    const key = (call.input as { key?: string }).key;
    if (key !== undefined) {
      const first = firstWithKey(sql, caller, key, arrivedAt);
      if (first && first.tool !== tool) {
        return failure("invalid_input", "This key was already given with another tool.");
      }
      if (first) return first.result;
    }
    const result = await handler(call);
    if (key !== undefined) rememberKey(sql, { caller, key, tool, at: arrivedAt, result });
    return result;
  }
}
