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
import { callNoLongerGoing, nameCallGoing } from "./call-going-rows.ts";
import {
  callableConnection,
  carryMove,
  contextObjectOf,
  type DeploymentCall,
  type DeploymentHandlers,
  deploymentHandlers,
  isListed,
  isReachable,
  otherContextNames,
} from "./deployment-tools.ts";
import { deviceHandlers, noteSeen, notifyDevices } from "./devices.ts";
import { rememberKey, repeatedKey } from "./keys.ts";
import { climb, deploymentStuck, releaseOf, type StuckUpgrade } from "./ladder.ts";
import { logCall } from "./log.ts";
import type { Move, MovedBy } from "./move-rows.ts";
import { type KeyReport, standingNotices, takeKeyReport } from "./notice-rows.ts";
import type { PushSender } from "./push.ts";
import type { ToolRequest } from "./registry.ts";
import { restoreHandlers } from "./restore.ts";
import { readSpend, type SpendReport, takeSpendReport } from "./spend-rows.ts";
import { DEPLOYMENT_LADDER, type Step } from "./steps/index.ts";
import { noteUpgrade } from "./upgrade-rows.ts";

/** Every Deployment tool's handler. */
const handlers: DeploymentHandlers = {
  ...deploymentHandlers,
  ...deviceHandlers,
  ...backupHandlers,
  ...restoreHandlers,
};

/**
 * The Deployment object, given how it sends a Notification: by Web Push with the Deployment's
 * key pair, or by the fake in tests (section 13); and its ladder, the release's, or one a test
 * gives it to make a step fail (test/upgrade-faults.ts).
 */
export function deploymentObject(
  pushOf: (env: Env) => PushSender,
  ladderFor: (id: string) => readonly Step[] = () => DEPLOYMENT_LADDER,
) {
  /**
   * The one object that belongs to the Deployment rather than to a Context (ADR 0006). It holds
   * the list of Contexts with their names and accents, and nothing from any Journal, and never
   * reads one. Each call between it and a Context's object is on the closed lists of ADR 0006 and
   * SPEC section 9.2: a new one amends both.
   *
   * Stuck on its upgrade (section 11), it serves nothing: every call throws `deploymentStuck`,
   * which the Worker answers with one plain page, but `upgradeStuck`, which says why.
   */
  return class DeploymentObject extends DurableObject<Env> {
    readonly #push: PushSender;
    #stuck: StuckUpgrade | null = null;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      this.#push = pushOf(env);
      ctx.blockConcurrencyWhile(async () => {
        const climbed = await climb(ctx.storage, {
          object: "deployment",
          ladder: ladderFor(ctx.id.toString()),
          release: releaseOf(env),
        });
        this.#stuck = climbed.stuck;
      });
    }

    /** Throw while the object is stuck on its upgrade: nothing can be routed (section 11). */
    private serving(): void {
      if (this.#stuck !== null) throw deploymentStuck(this.#stuck);
    }

    /**
     * Why this object is stuck on its upgrade, or null: the Worker asks before it serves the
     * screen, so a stuck Deployment shows one plain page (section 11).
     */
    async upgradeStuck(): Promise<StuckUpgrade | null> {
      return this.#stuck;
    }

    /**
     * A Context's object saying it is stuck on its upgrade, or no longer, as it wakes: every other
     * Context names it in a standing Notice while it is (section 11).
     */
    async noteUpgrade(context: string, stuck: StuckUpgrade | null): Promise<void> {
      this.serving();
      noteUpgrade(this.ctx.storage.sql, context, stuck);
    }

    /**
     * Call a Deployment tool. They are offered to the person's hand only (section 4.11): any other
     * caller is refused before its input is read.
     */
    async call(request: ToolRequest): Promise<ToolResult<unknown>> {
      this.serving();
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
      this.serving();
      return isReachable(this.ctx.storage.sql, id);
    }

    /**
     * The Connection an MCP address names, asked on every call, so ending one or switching it to
     * reading only takes effect on the next (section 7.2). Null when it has ended, its Context is
     * retired, or there never was one: the caller cannot tell these apart.
     */
    async callableConnection(id: string): Promise<Connection | null> {
      this.serving();
      return callableConnection(this.ctx.storage.sql, id);
    }

    /**
     * What a Context's object asks at the start of every Run (section 5.2): the names of the
     * Contexts shown other than this one, and nothing else of them, and the month's spend against
     * the cap, which says whether a Run may start. Embedding asks the same of `beforeEmbedding`
     * before it spends, and stops at the cap.
     */
    async beforeRun(id: string, at: number): Promise<{ otherContexts: string[]; spend: Spend }> {
      this.serving();
      const sql = this.ctx.storage.sql;
      return { otherContexts: otherContextNames(sql, id), spend: readSpend(sql, at) };
    }

    /**
     * A Context's report of what its Runs, its Calls and its embedding have spent in a calendar
     * month, in all, counted against the cap (section 5.7).
     */
    async takeSpendReport(report: SpendReport): Promise<void> {
      this.serving();
      takeSpendReport(this.ctx.storage.sql, report);
    }

    /**
     * Whether a Call may start in a Context, or go on, which is the cap: at it, none starts, and
     * the one going is ended (section 6). It brings the Context's report of what it has spent so
     * far, a Call going counted to the moment, so the Call's time is counted as it goes.
     */
    async beforeCall(report: SpendReport, at: number): Promise<Spend> {
      this.serving();
      const sql = this.ctx.storage.sql;
      takeSpendReport(sql, report);
      return readSpend(sql, at);
    }

    /**
     * A Context's word that a Call has started there: it is the one Call going in the Deployment,
     * and the one before it, in whichever Context, is ended there (section 6). It is named the one
     * going before the other is ended, so of two started at once the later always stands. A Context
     * deleted since has no Call left to end.
     */
    async callStarting(context: string, call: string, at: number): Promise<void> {
      this.serving();
      const sql = this.ctx.storage.sql;
      const before = nameCallGoing(sql, { context_id: context, call });
      if (before === null) return;
      if (!isListed(sql, before.context_id)) return;
      try {
        await contextObjectOf(this.env, before.context_id).endReplaced(before.call, at);
      } catch {
        // Ended there once its Device falls silent.
        console.error(JSON.stringify({ call: "unended", why: "replaced" }));
      }
    }

    /** A Context's word that a Call there has ended: none is going, unless another started since. */
    async callEnded(context: string, call: string): Promise<void> {
      this.serving();
      callNoLongerGoing(this.ctx.storage.sql, { context_id: context, call });
    }

    /**
     * Whether a Context may embed for its meaning index, which is the cap: at it, embedding stops
     * (section 5.7). It brings the Context's report of what it has spent so far, so what its
     * searches cost is counted as they go.
     */
    async beforeEmbedding(report: SpendReport, at: number): Promise<Spend> {
      this.serving();
      const sql = this.ctx.storage.sql;
      takeSpendReport(sql, report);
      return readSpend(sql, at);
    }

    /**
     * A Context's report that the model's provider refused the key in a Run, or took it, or the
     * voice provider the voice key in setting a Call up. Each key is the Deployment's, so its
     * refusal is a standing Notice in every Context until a call succeeds in any (sections 5.6, 6).
     */
    async takeKeyReport(report: KeyReport): Promise<void> {
      this.serving();
      takeKeyReport(this.ctx.storage.sql, report);
    }

    /**
     * The Deployment's standing Notices as at `at`, which a Context's `list_notices` gives with its
     * own (section 8.3).
     */
    async standingNotices(at: number): Promise<StandingNotice[]> {
      this.serving();
      return standingNotices(this.ctx.storage.sql, at);
    }

    /**
     * A Context's word that the Agent has left a Brief or a Review there with something to raise
     * and its switch is on: its Notification goes to every Device switched on (section 8.7). It
     * is told the kind, never what was said.
     */
    async notifyDevices(context: string, kind: ClockKind, at: number): Promise<void> {
      this.serving();
      await notifyDevices(this.ctx.storage.sql, this.#push, { context, kind, at });
    }

    /**
     * A Context's alarm asking for a unit it holds on its way out to be carried to the Context it
     * moves to, when the move was interrupted (section 3.9). It runs one at a time with the
     * writes, so the Context it goes to is not deleted while it is carried: deleted before, the
     * unit goes back. A failure is thrown to the asking Context, which tries again later.
     */
    async carryMove(move: Move, to: string, by: MovedBy): Promise<"taken" | "gone"> {
      this.serving();
      const outcome = await this.ctx.blockConcurrencyWhile(async () => {
        try {
          return await carryMove(this.ctx.storage.sql, this.env, move, to, by);
        } catch {
          // Thrown outside, since a throw here would reset this object.
          return "failed" as const;
        }
      });
      if (outcome === "failed") throw new Error("The move could not be carried");
      return outcome;
    }

    /**
     * The daily Backup, which the Worker's daily trigger asks for at the time it fired (section
     * 10.1). It wakes every Context's object, retired ones too, for its file. A failure is
     * answered, not thrown: the standing Notice tells the person after three days of them.
     */
    async backUp(at: number): Promise<BackupOutcome> {
      this.serving();
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
