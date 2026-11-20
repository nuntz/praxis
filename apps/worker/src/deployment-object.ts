import { DurableObject } from "cloudflare:workers";
import {
  type ClockKind,
  type Connection,
  type DeploymentToolName,
  failure,
  isDeploymentToolName,
  isDeploymentWrite,
  offeredDeploymentTool,
  parseDeploymentToolInput,
  type Spend,
  type StandingNotice,
  type ToolResult,
} from "@praxis/domain";
import { startTimer } from "./arrival.ts";
import { type BackupOutcome, backUp, backupHandlers } from "./backups.ts";
import { createDeploymentTables } from "./deployment-tables.ts";
import {
  callableConnection,
  type DeploymentCall,
  type DeploymentHandlers,
  deploymentHandlers,
  isReachable,
  otherContextNames,
} from "./deployment-tools.ts";
import { deviceHandlers, noteSeen, notifyDevices } from "./devices.ts";
import { rememberKey, repeatedKey } from "./keys.ts";
import { logCall } from "./log.ts";
import { type KeyReport, standingNotices, takeKeyReport } from "./notice-rows.ts";
import type { PushSender } from "./push.ts";
import type { ToolRequest } from "./registry.ts";
import { readSpend, type SpendReport, takeSpendReport } from "./spend-rows.ts";

/** Every Deployment tool's handler. */
const handlers: DeploymentHandlers = {
  ...deploymentHandlers,
  ...deviceHandlers,
  ...backupHandlers,
};

/**
 * The Deployment object, given how it sends a Notification: by Web Push with the Deployment's
 * key pair, or by the fake in tests (section 13).
 */
export function deploymentObject(pushOf: (env: Env) => PushSender) {
  /**
   * The one object that belongs to the Deployment rather than to a Context (ADR 0006). It holds
   * the list of Contexts with their names and accents, and nothing from any Journal, and never
   * reads one. Each call between it and a Context's object is on the closed lists of ADR 0006 and
   * SPEC section 9.2: a new one amends both.
   */
  return class DeploymentObject extends DurableObject<Env> {
    readonly #push: PushSender;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      this.#push = pushOf(env);
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
      logCall(
        { tool: known, write: known !== null && isDeploymentWrite(known) },
        result,
        elapsed(),
      );
      // After the call, so a Device it lists for the first time is seen at once.
      if (request.device !== undefined) {
        noteSeen(this.ctx.storage.sql, request.device, request.arrivedAt);
      }
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

    /**
     * What a Context's object asks at the start of every Run (section 5.2): the names of the
     * Contexts shown other than this one, and nothing else of them, and the month's spend against
     * the cap, which says whether a Run may start. Embedding asks the same of `beforeEmbedding`
     * before it spends, and stops at the cap.
     */
    async beforeRun(id: string, at: number): Promise<{ otherContexts: string[]; spend: Spend }> {
      const sql = this.ctx.storage.sql;
      return { otherContexts: otherContextNames(sql, id), spend: readSpend(sql, at) };
    }

    /**
     * A Context's report of what its Runs and its embedding have spent in a calendar month, in
     * all, counted against the cap (section 5.7).
     */
    async takeSpendReport(report: SpendReport): Promise<void> {
      takeSpendReport(this.ctx.storage.sql, report);
    }

    /**
     * Whether a Context may embed for its meaning index, which is the cap: at it, embedding stops
     * (section 5.7). It brings the Context's report of what it has spent so far, so what its
     * searches cost is counted as they go.
     */
    async beforeEmbedding(report: SpendReport, at: number): Promise<Spend> {
      const sql = this.ctx.storage.sql;
      takeSpendReport(sql, report);
      return readSpend(sql, at);
    }

    /**
     * A Context's report that the model's provider refused the key in a Run, or took it. The key is
     * the Deployment's, so its refusal is a standing Notice in every Context until a call succeeds
     * in any (section 5.6).
     */
    async takeKeyReport(report: KeyReport): Promise<void> {
      takeKeyReport(this.ctx.storage.sql, report);
    }

    /**
     * The Deployment's standing Notices as at `at`, which a Context's `list_notices` gives with its
     * own (section 8.3).
     */
    async standingNotices(at: number): Promise<StandingNotice[]> {
      return standingNotices(this.ctx.storage.sql, at);
    }

    /**
     * A Context's word that the Agent has left a Brief or a Review there with something to raise
     * and its switch is on: its Notification goes to every Device switched on (section 8.7). It
     * is told the kind, never what was said.
     */
    async notifyDevices(context: string, kind: ClockKind, at: number): Promise<void> {
      await notifyDevices(this.ctx.storage.sql, this.#push, { context, kind, at });
    }

    /**
     * The daily Backup, which the Worker's daily trigger asks for at the time it fired (section
     * 10.1). It wakes every Context's object, retired ones too, for its file. A failure is
     * answered, not thrown: the standing Notice tells the person after three days of them.
     */
    async backUp(at: number): Promise<BackupOutcome> {
      return backUp(this.ctx.storage.sql, this.env, at);
    }

    private async run<N extends DeploymentToolName>(
      tool: N,
      request: ToolRequest,
    ): Promise<ToolResult<unknown>> {
      const parsed = parseDeploymentToolInput(tool, request.input);
      if (!parsed.ok) return parsed;
      const handler = handlers[tool] as (call: DeploymentCall<N>) => Promise<ToolResult<unknown>>;
      const call: DeploymentCall<N> = {
        caller: request.caller,
        input: parsed.input,
        arrivedAt: request.arrivedAt,
        sql: this.ctx.storage.sql,
        env: this.env,
        deploymentId: this.ctx.id.toString(),
        push: this.#push,
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
      const repeated = repeatedKey(sql, { caller, key, tool, at: arrivedAt });
      if (repeated) return repeated;
      const result = await handler(call);
      if (key !== undefined) rememberKey(sql, { caller, key, tool, at: arrivedAt, result });
      return result;
    }
  };
}
