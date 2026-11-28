import { DurableObject } from "cloudflare:workers";
import type { Wake } from "@earendil-works/pi-durable";
import {
  type CallEnd,
  type Caller,
  type CallRecord,
  type Change,
  type ClockKind,
  type ContextFile,
  type ContextMade,
  type ConversationToolInput,
  type ConversationToolName,
  capInTheWay,
  dayIn,
  dollars,
  type Effect,
  failure,
  isConnection,
  isConversationToolName,
  isRecordlessWrite,
  isToolName,
  isWrite,
  type LiveMessage,
  monthOf,
  NOTHING_GOES_UP,
  type NoAgent,
  offeredConversationTool,
  parseConversationToolInput,
  type RunTranscript,
  refusal,
  type SearchIndex,
  SIGN_OF_LIFE_LAPSE,
  success,
  type ToolInput,
  type ToolOutput,
  type ToolResult,
} from "@praxis/domain";
import {
  type Bearings,
  type ClockBearings,
  ContextAgent,
  DIGEST_CHANGES,
  dropRuntimeTables,
  HELD_NAMED,
  holdsRuntimeTables,
  type KeptConversation,
} from "./agent.ts";
import { arrivalTime, startTimer } from "./arrival.ts";
import {
  callById,
  callRecord,
  callsGoing,
  endCall,
  insertCall,
  keepEndHeardByObject,
  noteAlive,
} from "./call-rows.ts";
import {
  appendChange,
  changesAfter,
  changesByOthers,
  encodeCursor,
  holdsChanges,
  lastChange,
  pruneChanges,
} from "./change-log.ts";
import {
  clockCapped,
  clockEnded,
  clockNotices,
  clockStarted,
  dueClockRuns,
  nextClockWake,
  noClockWithoutAgent,
  noteShown,
  startSchedule,
} from "./clock-rows.ts";
import {
  holdsConnectionCalls,
  keepConnectionCall,
  pruneConnectionCalls,
} from "./connection-call-rows.ts";
import { contextFile } from "./context-file.ts";
import { heldWaiting } from "./held-change-rows.ts";
import { forgetOldKeys, holdsKeys, rememberKey, repeatedKey } from "./keys.ts";
import { climb, releaseOf, type StuckUpgrade, stuckWords } from "./ladder.ts";
import { logCall } from "./log.ts";
import {
  embeddingCost,
  LIKE_ENOUGH,
  MEANING_REMOVAL_BATCH,
  type MeaningIndex,
  NEAREST,
} from "./meaning.ts";
import {
  anythingQueued,
  entriesInIndex,
  entriesToEmbed,
  meaningBuilt,
  queued,
  recordEmbedding,
  takeOffQueue,
} from "./meaning-rows.ts";
import type { AgentModel } from "./model.ts";
import {
  type Begun,
  forgetMovesTaken,
  holdMove,
  letGo,
  type Move,
  type MovedBy,
  type MoveSeed,
  moveHolding,
  movesOut,
  moveUnit,
  noteTaken,
  putIn,
  takenAlready,
  takeOut,
} from "./move-rows.ts";
import { sessionRequest, type VoiceRefusal } from "./provider-session.ts";
import {
  admit,
  dispatch,
  type Handlers,
  isObjectTool,
  type ObjectToolName,
  type ToolRequest,
} from "./registry.ts";
import { putBack, type Restoring } from "./restore-rows.ts";
import { deploymentOf } from "./routing.ts";
import {
  forgetConversation,
  handlesOf,
  keepHandles,
  lastToldChange,
  newestRun,
  nextTryFrom,
  type RunRow,
  recordRunNotStarted,
  runById,
  runRecord,
  runsNotEnded,
  spentInMonth,
} from "./run-rows.ts";
import { askSearch, type MeaningAnswer, type SearchAsked, search } from "./search-rows.ts";
import {
  contextEffect,
  deploymentOfContext,
  makeContext,
  readSettings,
  renameContext,
  timeZoneOf,
} from "./settings.ts";
import type { SpendReport } from "./spend-rows.ts";
import { standingEntries } from "./standing-rows.ts";
import { CONTEXT_LADDER, type Step } from "./steps/index.ts";
import {
  keepMeaningModel,
  queueToEmbedAgain,
  queueWholeJournal,
  untouchedByAnyStep,
} from "./tables.ts";
import { attentionTools } from "./tools/attention.ts";
import { changeTools } from "./tools/changes.ts";
import { connectionCallTools } from "./tools/connection-calls.ts";
import { entryTools, NO_SUCH_ENTRY } from "./tools/entries.ts";
import { heldChangeTools } from "./tools/held-changes.ts";
import { moveTools } from "./tools/moves.ts";
import { personTools } from "./tools/persons.ts";
import { NO_SUCH_PROJECT, projectTools } from "./tools/projects.ts";
import { recurrenceTools } from "./tools/recurrences.ts";
import { runTools } from "./tools/runs.ts";
import { settingsTools } from "./tools/settings.ts";
import { taskTools } from "./tools/tasks.ts";
import { trashTools } from "./tools/trash.ts";
import { waitTools } from "./tools/waits.ts";
import { expireTrash, nextExpiry } from "./trash-rows.ts";
import type { VoiceProvider } from "./voice.ts";

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
  ...attentionTools,
  ...trashTools,
  ...heldChangeTools,
  ...moveTools,
  ...runTools,
  ...connectionCallTools,
};

/** How long the alarm sleeps between wakes while it has something to do. */
const ALARM_GAP = 24 * 60 * 60 * 1000;

/**
 * How soon the alarm comes back while the Agent is working, so an object evicted mid-Run is woken
 * to finish it.
 */
const RUN_HEARTBEAT = 60 * 1000;

/** Why a Message is refused when there is no Agent: the person mends it in the configuration. */
const NO_AGENT: Record<NoAgent, string> = {
  no_key:
    "There is no Agent in this Deployment: its configuration gives no key for the model. Giving one is a change to the configuration and a deploy.",
  model_has_no_price:
    "There is no Agent in this Deployment: its configuration names a model Praxis ships no price for, so no Run could be counted. Naming another is a change to the configuration and a deploy.",
};

/**
 * Why a Message is refused when the runtime cannot open this Conversation's tables under this
 * release (section 11): a release that mends it does, and so does clearing the Conversation, which
 * starts it afresh and loses only what was said in it.
 */
const CONVERSATION_UNOPENED =
  "This Context's Conversation cannot be opened under this release, so the Agent answers nothing here until a release that mends it is deployed, or until the Conversation is cleared in this Context's settings, which starts it afresh: the Journal and Connections work as before.";

/** Why no Call starts without the voice key: the person gives one in the configuration. */
const NO_VOICE =
  "There is no way to start a Call in this Deployment: its configuration gives no key for the voice provider. Giving one is a change to the configuration and a deploy.";

/** Why the voice provider set no Call up: the person mends a refused key, and waits otherwise. */
const VOICE_REFUSED: Record<VoiceRefusal, string> = {
  key_refused:
    "The voice provider refused this Deployment's voice key, so no Call was started. Giving another is a change to the configuration and a deploy.",
  unavailable:
    "The voice provider could not be reached, so no Call was started. Try again in a while.",
};

/** A Call `end_call` names that this Context never set up. */
const NO_SUCH_CALL = "There is no such Call in this Context.";

/** A Call refused because the month's spend has reached the cap, with the cap in the way. */
function callCapRefusal(cap: number): ToolResult<never> {
  return refusal(
    `This month's spend has reached the cap of ${dollars(cap)}, so no Call starts. Raising the cap in the Deployment's settings lets one start at once; otherwise Calls start again when the month turns.`,
    [capInTheWay(cap)],
  );
}

/**
 * What the voice says as the object ends a Call at the cap, given to it on the provider's side
 * channel before the session is closed (section 6): nothing of the Journal, and no number.
 */
export const CAP_SAID =
  "This month's spend has reached its cap, so this Call ends now. Raising the cap in the settings lets another start.";

/** A Message `note_shown` names that is no Brief or Review shown in this Conversation. */
function noSuchBrief(): ToolResult<never> {
  return failure("not_found", "There is no such Brief or Review in this Context's Conversation.");
}

/** How many queued Entries the object embeds, or takes out of the meaning index, at once. */
const MEANING_BATCH = 20;

/**
 * How soon the alarm comes back to try the meaning index's queue again, once embedding stopped at
 * a failure or at the cap: a write or a search tries sooner.
 */
const MEANING_RETRY = 10 * 60 * 1000;

/**
 * Log that the meaning index failed, by the name of what was thrown alone: its message may carry
 * what was sent, and no words are logged (section 13).
 */
function meaningFailed(during: "search" | "embedding" | "deleting", error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  console.error(JSON.stringify({ meaning: "failed", during, error: name }));
}

/**
 * How soon the alarm comes back to carry a unit on its way out to the Context it goes to, once
 * the move was interrupted (section 3.9).
 */
const MOVE_RETRY = 10 * 60 * 1000;

/**
 * What a Context's object answers when it has taken a unit out of itself for a move: the move,
 * and the record asked for, its unit and the Effects in this Context, which its log holds.
 */
export type MoveBegun = Begun & { move: Move };

/** A Run refused because the month's spend has reached the cap, with the cap in the way. */
function capRefusal(cap: number): ToolResult<never> {
  return refusal(
    `This month's spend has reached the cap of ${dollars(cap)}, so no new Run starts. Raising the cap in the Deployment's settings lets one start at once; otherwise Runs start again when the month turns.`,
    [capInTheWay(cap)],
  );
}

/**
 * What a Context's object answers while it is stuck on its upgrade (section 11): it serves nothing,
 * reads included, and only a release that mends it changes that, which the person can only wait
 * for. Its tables are not read, since new code would be reading old ones.
 */
function stuckRefusal(stuck: StuckUpgrade): ToolResult<never> {
  return refusal(
    `This Context shows and changes nothing until a release that mends its upgrade is deployed: ${stuckWords(stuck)}. Nothing in it was changed or lost, and the other Contexts work as before.`,
    [],
  );
}

/** The ContextFile a Context's object answers for an Export, or that it is stuck on its upgrade. */
export type ExportAnswer = { file: ContextFile } | { stuck: StuckUpgrade };

/**
 * The Context object, given where its Agent's model comes from: the Deployment's configuration, or
 * a scripted model in tests (section 13). Without a model, `modelOf` says why there is no Agent.
 * Its meaning index is the Deployment's bindings, or the fake in tests, or none. Its voice provider
 * is reached with the Deployment's voice key, or is the fake in tests, or none. Its ladder is the
 * release's, or one a test gives an object to make a step fail (test/upgrade-faults.ts).
 */
export function contextObject(
  modelOf: (env: Env) => AgentModel | NoAgent,
  meaningOf: (env: Env) => MeaningIndex | null,
  voiceOf: (env: Env) => VoiceProvider | null,
  ladderFor: (id: string) => readonly Step[] = () => CONTEXT_LADDER,
) {
  /**
   * One Context: its Journal and everything else it holds, on its own SQLite (ADR 0006). Each
   * method the Deployment object calls on it is on the closed list of ADR 0006 and SPEC section
   * 9.2: a new one amends both.
   */
  return class ContextObject extends DurableObject<Env> {
    /** The Agent, opened on first use: most requests never need it. */
    #agent: ContextAgent | NoAgent | undefined;
    /** What the Agent's runtime last said it needs a process for. */
    #agentWake: Wake = { active: false };
    /**
     * How far the clock requests arrive by stands from the platform's: none when deployed, and
     * wherever a test has set it. The Agent's calls arrive by it, the alarm wakes by it, and the
     * platform's alarm is set by the real clock it stands from.
     */
    #clockSkew = 0;
    /** The meaning index's queue being worked through, one pass at a time. */
    #meaning: Promise<void> = Promise.resolve();
    #embedding = false;
    /** Whether the last pass stopped at a failure or at the cap, leaving the queue for the alarm. */
    #meaningStopped = false;
    /** Set while the Context is being deleted for good, and kept once it is: nothing new starts. */
    #deleting = false;
    /** Set once its storage is gone, so being asked again, as after an answer lost, succeeds. */
    #deleted = false;
    /**
     * Why it serves nothing, while it is stuck on its upgrade (section 11): until it wakes under
     * another release, nothing reads or writes its tables and its clock stops.
     */
    #stuck: StuckUpgrade | null = null;
    /** Set when it woke no longer stuck: its clock starts again on the first thing to reach it. */
    #clockStopped = false;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      ctx.blockConcurrencyWhile(async () => {
        const climbed = await climb(ctx.storage, {
          object: "context",
          ladder: ladderFor(ctx.id.toString()),
          release: releaseOf(env),
          untouched: untouchedByAnyStep,
        });
        this.#stuck = climbed.stuck;
        if (climbed.stuck === null) keepMeaningModel(ctx.storage.sql);
        this.#clockStopped = climbed.cameBack;
        if (climbed.stuck !== null || climbed.cameBack) void this.tellUpgrade(climbed.stuck);
      });
    }

    /**
     * Tell the Deployment object this Context is stuck on its upgrade, or no longer, so every other
     * Context names it in a standing Notice while it is (section 11). Its Deployment object is read
     * from its settings, the one row it reads while stuck, to know whom to tell. Not told, the daily
     * Backup finds it out.
     */
    private async tellUpgrade(stuck: StuckUpgrade | null): Promise<void> {
      try {
        let deployment: ReturnType<typeof deploymentOf>;
        try {
          deployment = this.deployment();
        } catch {
          deployment = deploymentOf(this.env);
        }
        await deployment.noteUpgrade(this.contextId(), stuck);
      } catch {
        console.error(JSON.stringify({ upgrade: "untold", stuck: stuck !== null }));
      }
    }

    /**
     * Start the clock again once the object is no longer stuck, as at `at`: while it was stuck its
     * alarm came and did nothing, so nothing is armed. It wakes at once, so what fell due meanwhile
     * is done, the Trash past its 30 days from each delete removed among it, and its wake keeps the
     * alarm from there. Armed, not run here, since the Deployment object may be waiting on this
     * call and a wake asks it things.
     */
    private async restartClock(at: number): Promise<void> {
      if (!this.#clockStopped) return;
      this.#clockStopped = false;
      this.#clockSkew = at - arrivalTime();
      await this.ctx.storage.setAlarm(arrivalTime());
    }

    /**
     * Make this Context with its name and time zone. The Deployment object calls it on
     * `create_context`, before it lists the Context, so no request reaches a Context not yet
     * made. The Context's id is its object's, and it keeps the id of the Deployment object.
     */
    async make(made: ContextMade, deployment: string, at: number): Promise<ToolResult<null>> {
      if (this.#stuck !== null) return stuckRefusal(this.#stuck);
      const sql = this.ctx.storage.sql;
      this.#clockSkew = at - arrivalTime();
      makeContext(sql, this.ctx.id.toString(), made, deployment);
      // Its first Brief and Review are the first to come after it was made.
      startSchedule(sql, at);
      await this.keepAlarm();
      return success(null);
    }

    /**
     * Make this Context from its file of an Export, which the Deployment object asks on
     * `restore_export` before it lists the Context (section 10.2): everything the file holds, every
     * record under its id, and what has been in the Trash 30 days by `at` removed for good. Its id
     * is its object's, new, and it keeps the name the Deployment lists it by. Refused, with nothing
     * changed, when the file does not hold together. Answers
     * what its Run records spent in the month of `at`, which counts against the cap.
     */
    async makeFromExport(file: ContextFile, as: Restoring): Promise<ToolResult<{ spent: number }>> {
      if (this.#stuck !== null) return stuckRefusal(this.#stuck);
      const sql = this.ctx.storage.sql;
      this.#clockSkew = as.at - arrivalTime();
      try {
        this.ctx.storage.transactionSync(() => putBack(sql, this.ctx.id.toString(), as, file));
      } catch (error) {
        return failure(
          "invalid_input",
          `This is not an Export Praxis can restore: the file of ${as.name} does not hold together (${error instanceof Error ? error.message : "it could not be put in"}).`,
        );
      }
      // Its Entries wait queued for the meaning index, as on waking under a new model: embedding
      // asks the Deployment object, which waits on this call, and a restore undone deletes this
      // object, which waits on embedding. The alarm, the first search or the first write starts it.
      this.#meaningStopped = true;
      await this.keepAlarm();
      return success({ spent: spentInMonth(sql, as.at) });
    }

    /**
     * Give this Context the name the Deployment object lists it by, on `rename_context`. A change
     * to its settings is an Effect on it, so the rename goes in its change log with the caller.
     */
    async rename(name: string, by: { caller: Caller; at: number }): Promise<ToolResult<null>> {
      if (this.#stuck !== null) return stuckRefusal(this.#stuck);
      await this.restartClock(by.at);
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
      return success(null);
    }

    /**
     * This Context's file of an Export, as at `at`, which the Deployment object asks for on
     * `make_export` (section 10.1). Each Context's object writes its own, so the files of one
     * Export are not one instant (ADR 0018). One stuck on its upgrade writes none, and says so.
     */
    async exportFile(at: number): Promise<ExportAnswer> {
      if (this.#stuck !== null) return { stuck: this.#stuck };
      await this.restartClock(at);
      return { file: contextFile(this.ctx.storage.sql, at) };
    }

    /**
     * What a Run Transcript holds of one of this Context's Runs (section 5.8), which the
     * Deployment object asks for on `save_run_transcript` and carries to the person, reading none
     * of it. A Run still going, one never started at the cap, and one whose Conversation was
     * cleared since have none; nor does one while the Conversation cannot be opened.
     */
    async runTranscript(
      id: string,
    ): Promise<ToolResult<Pick<RunTranscript, "run" | "prompt" | "tools" | "messages">>> {
      if (this.#stuck !== null) return stuckRefusal(this.#stuck);
      const agent = await this.conversation();
      // Read once the Conversation is open, and again after the last wait.
      const sql = this.ctx.storage.sql;
      const run = runById(sql, id);
      if (run === null) return failure("not_found", "There is no such Run in this Context.");
      if (run.ended === null) {
        return refusal(
          "This Run is still going: its transcript can be saved once it has ended.",
          [],
        );
      }
      if (run.ended === "cap_reached") {
        return refusal(
          "This Run never started, since the month's spend had reached the cap: nothing was given, said or called in it.",
          [],
        );
      }
      const cleared = refusal(
        "This Run's Conversation has been cleared since, so nothing of what was said in it is kept.",
        [],
      );
      if (run.submission === null) return cleared;
      if (typeof agent === "string") {
        return refusal(agent === "unavailable" ? CONVERSATION_UNOPENED : NO_AGENT[agent], []);
      }
      // A clear meanwhile drops the records being read and lets go of the Run's handle on them.
      const clearedSince = () => runById(sql, id)?.submission !== run.submission;
      let kept: Awaited<ReturnType<ContextAgent["transcript"]>>;
      try {
        kept = await agent.transcript(this.ctx.storage, run, nextTryFrom(sql, run));
      } catch (error) {
        if (clearedSince()) return cleared;
        throw error;
      }
      const now = runById(sql, id);
      if (kept === null || now === null || clearedSince()) return cleared;
      return success({ run: runRecord(sql, now), ...kept });
    }

    /**
     * Take a unit out of this Context for a move to another, which the Deployment object asks on
     * `move_record` (section 3.9), as one write: what links across is dropped, each change an
     * Effect, the unit's records go from every view, and the move holds them until the Context
     * it goes to has taken them, the alarm carrying it there should the move be interrupted.
     * Refused, with nothing changed, when what would move is not the unit the person was shown,
     * or while a Task from an Entry that would move is in the Trash, or while it is stuck on its
     * upgrade. Asked again for a record it
     * holds on its way out, as when its answer was lost, it answers as it did, with the same move.
     */
    async beginMove(
      asked: { id: string; record: MoveSeed; unit: string[]; to: string },
      by: MovedBy,
    ): Promise<ToolResult<MoveBegun>> {
      if (this.#stuck !== null) return stuckRefusal(this.#stuck);
      await this.restartClock(by.at);
      const sql = this.ctx.storage.sql;
      const before = lastChange(sql);
      const result = this.ctx.storage.transactionSync((): ToolResult<MoveBegun> => {
        const holding = moveHolding(sql, asked.record);
        if (holding !== null) return success({ move: holding.move, ...holding.begun });
        const asItIs = moveUnit(sql, asked.record);
        if (asItIs === null) {
          return failure(
            "not_found",
            asked.record.kind === "entry" ? NO_SUCH_ENTRY : NO_SUCH_PROJECT,
          );
        }
        if (asItIs.in_the_trash.length > 0) {
          return refusal(
            "A Task from an Entry that would move is in the Trash, and a Task never leaves its Origin Entry: restore it, or remove it for good, before moving.",
            asItIs.in_the_trash,
          );
        }
        const seen = new Set(asked.unit);
        if (asItIs.unit.length !== seen.size || asItIs.unit.some(({ id }) => !seen.has(id))) {
          return refusal(
            "What would move with it has changed since it was shown: look at it again before moving it.",
            [asItIs.record],
          );
        }
        const today = dayIn(by.at, timeZoneOf(sql));
        const out = takeOut(sql, asked.record, by.at, today);
        if (out === null) throw new Error("A unit read a moment ago is gone");
        const move: Move = { id: asked.id, record: asked.record, unit: out.unit };
        const begun: Begun = { record: asItIs.record, unit: asItIs.unit, effects: out.effects };
        holdMove(sql, { move, to: asked.to, by, begun });
        appendChange(sql, {
          at: by.at,
          caller: by.caller,
          tool: "move_record",
          effects: out.effects,
        });
        return success({ move, ...begun });
      });
      await this.afterWrite(before);
      return result;
    }

    /**
     * Whether this Context's object can take a unit moved into it, which the Deployment object
     * asks before a move takes anything out of the Context it leaves (section 3.9). One being
     * deleted cannot, nor one stuck on its upgrade, which serves nothing (section 11), and one
     * that does not answer is taken to be unable.
     */
    async canTakeMove(): Promise<boolean> {
      return !this.#deleting && this.#stuck === null;
    }

    /**
     * Take a unit moved here from another Context, under its move id (section 3.9), as one write
     * in this Context's change log at the time it arrived: every record as it came, the one asked
     * for made by the call and the rest by rule. A move asked again, as when the answer was lost,
     * adds nothing and answers as it did.
     */
    async takeMove(move: Move, by: MovedBy): Promise<Effect[]> {
      if (this.#stuck !== null) throw new Error("A Context stuck on its upgrade takes nothing");
      await this.restartClock(by.at);
      const sql = this.ctx.storage.sql;
      const before = lastChange(sql);
      const effects = this.ctx.storage.transactionSync(() => {
        const already = takenAlready(sql, move);
        if (already !== null) return already;
        const made = putIn(sql, move.record, move.unit);
        noteTaken(sql, move.id, made, by.at);
        appendChange(sql, { at: by.at, caller: by.caller, tool: "move_record", effects: made });
        return made;
      });
      await this.afterWrite(before);
      return effects;
    }

    /** The Context a unit was moved to has taken it: this one lets it go (section 3.9). */
    async moveArrived(move: string): Promise<void> {
      // Stuck, it holds the unit until it comes back and its alarm hears it was taken.
      if (this.#stuck !== null) throw new Error("A Context stuck on its upgrade lets nothing go");
      letGo(this.ctx.storage.sql, move);
    }

    /**
     * Carry each unit on its way out to the Context it goes to, through the Deployment object, as
     * the alarm does for a move interrupted (section 3.9). One whose Context was deleted meanwhile
     * comes back here, so a unit is never lost. One that cannot be carried yet waits for the next.
     */
    private async finishMoves(at: number): Promise<void> {
      const sql = this.ctx.storage.sql;
      for (const out of movesOut(sql)) {
        let carried: "taken" | "gone";
        try {
          // It arrives now, as the person's hand asked.
          carried = await this.deployment().carryMove(out.move, out.to, { ...out.by, at });
        } catch {
          console.error(JSON.stringify({ move: "not_carried" }));
          continue;
        }
        if (carried === "taken") {
          letGo(sql, out.move.id);
          continue;
        }
        const before = lastChange(sql);
        // Another wake may have brought it back while this one waited for the answer.
        this.ctx.storage.transactionSync(() => {
          if (!movesOut(sql).some(({ move }) => move.id === out.move.id)) return;
          const back = putIn(sql, null, out.move.unit);
          letGo(sql, out.move.id);
          appendChange(sql, { at, caller: out.by.caller, tool: "move_record", effects: back });
        });
        await this.afterWrite(before);
      }
    }

    /**
     * Delete this Context for good, which the Deployment object asks on `delete_context` before it
     * takes the Context off its list (section 10.4): its part of the meaning index is taken out,
     * then its alarm and its whole storage go, Journal, Run records and Conversation alike, and its
     * live channels close. Nothing new starts meanwhile, and what is going is waited for, so
     * nothing writes once the storage is gone. Refused, with nothing deleted, while a Run is going
     * or when the meaning index does not answer, or while it is stuck on its upgrade: only waiting
     * mends any of these.
     */
    async deleteForGood(): Promise<ToolResult<null>> {
      if (this.#deleted) return success(null);
      if (this.#stuck !== null) return stuckRefusal(this.#stuck);
      this.#deleting = true;
      try {
        await this.#clocking;
        await this.meaningSettled();
        const sql = this.ctx.storage.sql;
        if (runsNotEnded(sql).length > 0) {
          return refusal(
            "A Run is going in this Context, so nothing was deleted: try again once it has ended.",
            [],
          );
        }
        // A unit on its way out is held only here until the other Context takes it.
        if (movesOut(sql).length > 0) {
          return refusal(
            "Something moved from this Context has not yet reached the Context it was moved to, so nothing was deleted: try again in a while.",
            [],
          );
        }
        const index = meaningOf(this.env);
        if (index !== null) {
          const entries = entriesInIndex(sql);
          let takenOut = 0;
          try {
            while (takenOut < entries.length) {
              const batch = entries.slice(takenOut, takenOut + MEANING_REMOVAL_BATCH);
              await index.remove(this.contextId(), batch);
              takenOut += batch.length;
            }
          } catch (error) {
            meaningFailed("deleting", error);
            // Those already out are put back in, so the index is whole again should the Context
            // be brought back, and is stale till then.
            const out = entries.slice(0, takenOut);
            if (out.length > 0) this.ctx.storage.transactionSync(() => queueToEmbedAgain(sql, out));
            return refusal(
              "The meaning index did not answer, so nothing was deleted: try again in a while.",
              [],
            );
          }
        }
        for (const channel of this.ctx.getWebSockets()) {
          try {
            channel.close(1000, "The Context was deleted");
          } catch {
            // Closing already.
          }
        }
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.#deleted = true;
        return success(null);
      } finally {
        // Once deleted, it stays so: the object starts nothing again until it is evicted.
        if (!this.#deleted) this.#deleting = false;
      }
    }

    /**
     * Call a Context tool through the registry, or a Conversation tool. `arrivedAt` is when the
     * call reached the Worker.
     */
    async call(request: ToolRequest): Promise<ToolResult<unknown>> {
      if (this.#stuck !== null) {
        const refused = stuckRefusal(this.#stuck);
        logCall({ tool: isToolName(request.tool) ? request.tool : null, write: false }, refused, 0);
        return refused;
      }
      const result = await this.serve(request);
      // Every call from a Connection is kept, reads included, as none of what it sent or was
      // given (section 7.3). None reaches a Context being deleted, which is retired first, and
      // retiring it ended its Connections. A stuck object keeps none, above, since it serves
      // nothing and its tables may be from before the record.
      const { caller } = request;
      if (isConnection(caller)) {
        const { tool, arrivedAt: at } = request;
        keepConnectionCall(this.ctx.storage.sql, { caller, tool, at, result });
        await this.keepAlarm();
      }
      return result;
    }

    /** Serve a call to a Context tool or a Conversation tool, once the object is known to serve. */
    private async serve(request: ToolRequest): Promise<ToolResult<unknown>> {
      await this.restartClock(request.arrivedAt);
      // The object's clock runs from when this request arrived, which a test sets.
      this.#clockSkew = request.arrivedAt - arrivalTime();
      if (isConversationToolName(request.tool)) return this.converse(request.tool, request);
      // An object new to a release may have its whole Journal to embed: any call starts it.
      this.keepMeaning();
      if (isObjectTool(request.tool)) return this.runObjectTool(request.tool, request);
      const elapsed = startTimer();
      const before = lastChange(this.ctx.storage.sql);
      const result = dispatch(handlers, this.ctx.storage, request);
      const tool = isToolName(request.tool) ? request.tool : null;
      logCall({ tool, write: isWrite(request.tool) }, result, elapsed());
      if (isWrite(request.tool)) await this.afterWrite(before);
      return result;
    }

    /**
     * Run a Context tool the object runs itself, for any caller: each lets the call in as
     * `dispatch` would, so one the caller is not offered is refused.
     */
    private async runObjectTool(
      tool: ObjectToolName,
      request: ToolRequest,
    ): Promise<ToolResult<unknown>> {
      const elapsed = startTimer();
      const result =
        tool === "list_notices"
          ? await this.listNotices(request)
          : tool === "search"
            ? await this.search(request)
            : tool === "clear_conversation"
              ? await this.clearConversation(request)
              : this.rebuildSearchIndex(request);
      // None of them returns Effects: a write among them changes no record.
      const write = isWrite(tool) && !isRecordlessWrite(tool);
      logCall({ tool, write }, result, elapsed());
      return result;
    }

    /**
     * `list_notices`: the standing Notices, offered to the hand only (section 8.3). The ones this
     * Context shows are the Deployment's, which its object is asked for: the key refused and the
     * month's spend against the cap.
     */
    private async listNotices(request: ToolRequest): Promise<ToolResult<unknown>> {
      const admitted = admit(request);
      if (!admitted.ok) return admitted;
      return success({
        items: [
          ...(await this.deployment().standingNotices(request.arrivedAt)),
          ...clockNotices(this.ctx.storage.sql),
        ],
      });
    }

    /**
     * `search` (section 9.4): one ranked list from words and from meaning, the same for every
     * caller. It is checked before the meaning index is asked, so a call it refuses costs nothing,
     * and the store is read again after, as it stands once the meaning index has answered.
     */
    private async search(request: ToolRequest): Promise<ToolResult<unknown>> {
      const admitted = admit(request);
      if (!admitted.ok) return admitted;
      const input = admitted.value.input as ToolInput<"search">;
      const sql = this.ctx.storage.sql;
      const asked = askSearch(sql, input);
      if (!asked.ok) return asked;
      // A Task's and a Project's state is read as on the day the search arrived, in the zone the
      // Context has when it is answered.
      const found = (searched: SearchAsked, meaning: MeaningAnswer) => {
        const zone = timeZoneOf(sql);
        return search(sql, input, zone, searched, meaning, dayIn(request.arrivedAt, zone));
      };
      // With no words, or none the index reads as a word, there is nothing to ask the meaning of.
      if (asked.value.query === null || input.words === undefined) {
        return success(found(asked.value, { nearest: [] }));
      }
      const meaning = await this.askMeaning(input.words, request.arrivedAt);
      // Read again as the store stands once the meaning index has answered: a Project or Person
      // narrowed by may have gone to the Trash meanwhile.
      const now = askSearch(sql, input);
      if (!now.ok) return now;
      return success(found(now.value, meaning));
    }

    /**
     * The Entries the meaning index finds nearest the words, alike enough to be found; or why it
     * was left out: there is none, it is being built, it did not answer, or the month's spend has
     * reached the cap, where embedding stops (section 5.7).
     */
    private async askMeaning(words: string, at: number): Promise<MeaningAnswer> {
      const index = meaningOf(this.env);
      if (index === null) return { words_only: "missing" };
      const sql = this.ctx.storage.sql;
      if (!meaningBuilt(sql)) return { words_only: "stale" };
      try {
        const spend = await this.deployment().beforeEmbedding(this.spendReport(at), at);
        if (spend.notice === "cap_reached") return { words_only: "cap_reached" };
        const [embedding] = await index.embed([words]);
        recordEmbedding(sql, at, embeddingCost([words]));
        if (embedding === undefined) throw new Error("No embedding for the words searched");
        const nearest = await index.nearest(this.contextId(), embedding, NEAREST);
        return {
          nearest: nearest
            .filter((found) => found.likeness >= LIKE_ENOUGH)
            .map(({ entry }) => entry),
        };
      } catch (error) {
        meaningFailed("search", error);
        return { words_only: "unreachable" };
      }
    }

    /**
     * `clear_conversation`, by the person's hand from the Context's settings (section 5.8): all of
     * the runtime's record is dropped at once, and the next thing to need the Agent opens it
     * afresh, which also mends a Conversation the runtime could not open under this release. What
     * came after `up_to`, the newest Message the screen had read, is read first and placed again
     * in the one opened afresh, so a clear never drops what the person was not shown. The
     * Journal, the change log and the Run records stay as they were, but for the Runs' handles on
     * the Conversation. It is refused while a Run is going, since the runtime is working in the
     * record it would drop. It changes no record and leaves no Effect; a repeated key answers as
     * the first call did.
     */
    private async clearConversation(request: ToolRequest): Promise<ToolResult<unknown>> {
      const admitted = admit(request);
      if (!admitted.ok) return admitted;
      const { key, up_to } = admitted.value.input as ToolInput<"clear_conversation">;
      // A Brief or a Review the clock is starting is going too, once it has started.
      await this.#clocking;
      const sql = this.ctx.storage.sql;
      const keyed = {
        caller: request.caller,
        key,
        tool: "clear_conversation",
        at: request.arrivedAt,
      };
      const going = () =>
        runsNotEnded(sql).length > 0
          ? refusal(
              "A Run is going in this Conversation, so nothing was cleared: try again once it has ended.",
              [],
            )
          : null;
      const repeated = repeatedKey(sql, keyed);
      if (repeated) return repeated;
      const before = going();
      if (before) return before;
      const kept = await this.keptThroughClear(Date.parse(up_to));
      // From here to the drop nothing awaits: no Run can start in the record being dropped, and the
      // key is read as the drop finds it.
      const started = going();
      if (started) return started;
      const handles = handlesOf(sql, kept.starts);
      const result: ToolResult<ToolOutput["clear_conversation"]> = success({
        conversation: "cleared",
      });
      this.ctx.storage.transactionSync(() => {
        dropRuntimeTables(sql);
        forgetConversation(sql);
        if (key !== undefined) rememberKey(sql, { ...keyed, key, result });
      });
      // The Agent held the runtime opened on the tables dropped: the next to need it opens anew.
      if (typeof this.#agent === "object") this.#agent = undefined;
      this.#agentWake = { active: false };
      if (kept.records.length > 0) {
        const agent = this.agent();
        if (typeof agent === "object") {
          const placed = await agent.placeKept(this.ctx.storage, kept.records);
          this.ctx.storage.transactionSync(() => keepHandles(sql, handles, placed));
        }
      }
      this.send({ kind: "cleared" });
      await this.keepAlarm();
      return result;
    }

    /**
     * What clearing the Conversation up to `upTo` keeps: what came after it. A Conversation never
     * opened keeps nothing, and neither does one the runtime cannot open under this release, which
     * is dropped whole, and so mended.
     */
    private async keptThroughClear(upTo: number): Promise<KeptConversation> {
      const none: KeptConversation = { records: [], starts: [] };
      if (!holdsRuntimeTables(this.ctx.storage.sql) || !this.hasAgent()) return none;
      const agent = await this.conversation();
      if (typeof agent !== "object") return none;
      return agent.keptAfter(this.ctx.storage, upTo);
    }

    /**
     * `rebuild_search_index`, by the person's hand from the Context's settings: every Entry is
     * queued to be embedded afresh, and search answers from words until it is done. It changes no
     * record and leaves no Effect, so nothing goes in the change log; a repeated key answers as
     * the first call did.
     */
    private rebuildSearchIndex(request: ToolRequest): ToolResult<unknown> {
      const admitted = admit(request);
      if (!admitted.ok) return admitted;
      const { key } = admitted.value.input as ToolInput<"rebuild_search_index">;
      const sql = this.ctx.storage.sql;
      const keyed = {
        caller: request.caller,
        key,
        tool: "rebuild_search_index",
        at: request.arrivedAt,
      };
      const repeated = repeatedKey(sql, keyed);
      if (repeated) return repeated;
      const result: ToolResult<SearchIndex> =
        meaningOf(this.env) === null
          ? refusal(
              "This Deployment has no meaning index, so there is nothing to rebuild: search finds by words alone. Its setup makes one (docs/deployment.md).",
              [],
            )
          : success({
              meaning: "building",
              entries_to_embed: this.ctx.storage.transactionSync(() => {
                queueWholeJournal(sql);
                return entriesToEmbed(sql);
              }),
            });
      if (key !== undefined) rememberKey(sql, { ...keyed, key, result });
      this.keepMeaning();
      return result;
    }

    /** This Context's id, which is its object's: its part of the meaning index goes by it. */
    private contextId(): string {
      return this.ctx.id.toString();
    }

    /** What this Context has spent in the month `at` falls in, as reported to the Deployment. */
    private spendReport(at: number): SpendReport {
      return {
        context: this.contextId(),
        month: monthOf(at),
        spent: spentInMonth(this.ctx.storage.sql, at),
      };
    }

    /**
     * Work through the meaning index's queue, unless a pass is going or there is nothing to do: a
     * pass takes up what was queued while it ran, so nothing waits for the next write.
     */
    private keepMeaning(): void {
      if (this.#embedding || this.#deleting || meaningOf(this.env) === null) return;
      if (!anythingQueued(this.ctx.storage.sql)) return;
      this.#embedding = true;
      this.#meaning = this.embedQueued().then(async (finished) => {
        this.#embedding = false;
        this.#meaningStopped = !finished;
        if (finished) this.keepMeaning();
        else await this.keepAlarm();
      });
    }

    /**
     * One pass through the meaning index's queue, a batch at a time: the Entries removed for good
     * are taken out, then the Entries made or changed are embedded and put in, until the queue is
     * empty. Each is taken off the queue only while it is as it was read, so one changed meanwhile
     * is embedded again. Embedding stops at the cap (section 5.7) and at a failure, and the queue
     * waits for the next write, search or alarm. What it cost is reported once the pass is done.
     * True when the queue was emptied.
     */
    private async embedQueued(): Promise<boolean> {
      const index = meaningOf(this.env);
      if (index === null) return false;
      const sql = this.ctx.storage.sql;
      const context = this.contextId();
      let spent = false;
      let finished = false;
      try {
        for (;;) {
          const batch = queued(sql, MEANING_BATCH);
          if (batch.length === 0) {
            finished = true;
            break;
          }
          const removed = batch.filter((item) => item.what === "remove");
          if (removed.length > 0) {
            await index.remove(
              context,
              removed.map(({ entry }) => entry),
            );
            takeOffQueue(sql, removed);
            continue;
          }
          const embedded = batch.flatMap((item) => (item.what === "embed" ? [item] : []));
          const at = arrivalTime() + this.#clockSkew;
          const spend = await this.deployment().beforeEmbedding(this.spendReport(at), at);
          if (spend.notice === "cap_reached") break;
          const texts = embedded.map(({ words }) => words);
          const embeddings = await index.embed(texts);
          recordEmbedding(sql, at, embeddingCost(texts));
          spent = true;
          await index.put(
            context,
            embedded.map(({ entry }, place) => ({ entry, embedding: embeddings[place] ?? [] })),
          );
          takeOffQueue(sql, embedded);
        }
      } catch (error) {
        meaningFailed("embedding", error);
      }
      if (spent) {
        const at = arrivalTime() + this.#clockSkew;
        try {
          await this.deployment().takeSpendReport(this.spendReport(at));
        } catch {
          // Counted with the next report: each is the month's whole total.
        }
      }
      return finished;
    }

    /**
     * Wait until the meaning index's queue has been worked through, as far as it goes. For tests,
     * which cannot see it otherwise.
     */
    async meaningSettled(): Promise<void> {
      for (;;) {
        const going = this.#meaning;
        await going;
        if (going === this.#meaning) return;
      }
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
      const agent = await this.conversation();
      if (tool === "list_messages") {
        const { cursor } = parsed.input as ConversationToolInput<"list_messages">;
        const voice = voiceOf(this.env) === null ? "no_key" : "available";
        if (typeof agent === "string") {
          return success({ items: [], next_cursor: null, agent, voice });
        }
        return success({ ...(await agent.messages(this.ctx.storage, cursor)), voice });
      }
      const { arrivedAt } = request;
      if (tool === "start_call") {
        const input = parsed.input as ConversationToolInput<"start_call">;
        return this.oneAtATime(() =>
          this.keyed(tool, request, input.key, () => this.startCall(agent, input, arrivedAt)),
        );
      }
      if (tool === "end_call") {
        const input = parsed.input as ConversationToolInput<"end_call">;
        return this.oneAtATime(() =>
          this.keyed(tool, request, input.key, () => this.endCall(input, arrivedAt)),
        );
      }
      if (tool === "note_call_alive") {
        const input = parsed.input as ConversationToolInput<"note_call_alive">;
        return this.oneAtATime(() =>
          this.keyed(tool, request, input.key, () => this.callAlive(input, arrivedAt)),
        );
      }
      const input = parsed.input as ConversationToolInput<
        "send_message" | "retry_run" | "note_shown"
      >;
      // The Call tools are run above, so what is left is one of these.
      if (typeof agent === "string") {
        return "message" in input
          ? noSuchBrief()
          : refusal(agent === "unavailable" ? CONVERSATION_UNOPENED : NO_AGENT[agent], []);
      }
      return this.keyed(tool, request, input.key, () =>
        "message" in input
          ? this.noteShown(agent, input.message, arrivedAt)
          : "run" in input
            ? this.retryRun(agent, input.run, arrivedAt)
            : this.startRun(agent, input, arrivedAt),
      );
    }

    /**
     * Run a Conversation write under its key: a repeat answers as the first call did, and does
     * nothing again.
     */
    private async keyed(
      tool: ConversationToolName,
      request: ToolRequest,
      key: string | undefined,
      run: () => Promise<ToolResult<unknown>>,
    ): Promise<ToolResult<unknown>> {
      const sql = this.ctx.storage.sql;
      const keyed = { caller: request.caller, key, tool, at: request.arrivedAt };
      const repeated = repeatedKey(sql, keyed);
      if (repeated) return repeated;
      const result = await run();
      if (key !== undefined) rememberKey(sql, { ...keyed, key, result });
      return result;
    }

    /** The last Call tool going or waiting: they run one at a time. */
    #callTools: Promise<unknown> = Promise.resolve();

    /**
     * Run a Call tool once the one before it has finished, so a Device's start, sign of life and
     * end of a Call are taken in the order they came. Each end still names the state it read, since
     * the alarm and the Deployment object end Calls outside this line.
     */
    private oneAtATime<T>(run: () => Promise<T>): Promise<T> {
      const going = this.#callTools.then(run, run);
      this.#callTools = going.catch(() => {});
      return going;
    }

    /**
     * `start_call` (section 6): set a Call up at the voice provider with the voice key, which never
     * reaches a Device, on the voice model with its instructions, and answer the Device's offer.
     * Refused without the Agent or the voice key, at the cap, and when the provider sets nothing
     * up. Once it is set up the Deployment object names it the one Call going, and ends the one
     * before it, in whichever Context.
     */
    private async startCall(
      agent: ContextAgent | NoAgent | "unavailable",
      input: ConversationToolInput<"start_call">,
      at: number,
    ): Promise<ToolResult<unknown>> {
      if (typeof agent === "string") {
        return refusal(agent === "unavailable" ? CONVERSATION_UNOPENED : NO_AGENT[agent], []);
      }
      const voice = voiceOf(this.env);
      if (voice === null) return refusal(NO_VOICE, []);
      const spend = await this.deployment().beforeCall(this.spendReport(at), at);
      if (spend.notice === "cap_reached") return callCapRefusal(spend.cap);
      const set = await voice.setUp(sessionRequest(input.offer));
      if (set === "key_refused") await this.reportVoiceKey({ key: "refused", at });
      if (typeof set === "string") return refusal(VOICE_REFUSED[set], []);
      const id = crypto.randomUUID();
      insertCall(this.ctx.storage.sql, { id, session: set.session, at });
      // Armed first, so a Call the Deployment object never hears of still ends once it is silent.
      await this.keepAlarm();
      await this.reportVoiceKey({ key: "taken", at });
      try {
        await this.deployment().callStarting(this.contextId(), id, at);
      } catch {
        console.error(JSON.stringify({ call: "untold", told: "starting" }));
      }
      return success({ call: { id, answer: set.answer } });
    }

    /**
     * Tell the Deployment object what the voice provider made of the voice key: refused, a standing
     * Notice in every Context, or taken, which ends it (section 6). A failure to reach it costs
     * only the Notice.
     */
    private async reportVoiceKey(report: { key: "refused" | "taken"; at: number }): Promise<void> {
      try {
        await this.deployment().takeKeyReport({ ...report, provider: "voice" });
      } catch {
        console.error(JSON.stringify({ key: "unreported", provider: "voice" }));
      }
    }

    /**
     * `end_call` (section 6): the Device reports a Call has ended, how, and what it heard of the
     * provider ending its session. When it heard nothing, the object ends the session on the
     * provider's side channel itself. One already ended is answered as it is.
     */
    private async endCall(
      input: ConversationToolInput<"end_call">,
      at: number,
    ): Promise<ToolResult<unknown>> {
      const sql = this.ctx.storage.sql;
      if (callById(sql, input.call) === null) return failure("not_found", NO_SUCH_CALL);
      const end = { at, ended: input.ended };
      if (input.provider_end === null) await this.endAtProvider(input.call, end);
      else if (endCall(sql, input.call, { ...end, heard: input.provider_end })) {
        await this.reportCallEnded(input.call, end);
      }
      return success({ call: this.callRecordOf(input.call) });
    }

    /**
     * `note_call_alive` (section 6): the Device's sign of life in a Call, every 15 seconds. What
     * the Call has cost so far is counted, and at the cap the object ends it at the provider,
     * having the voice say so first. Answers with its record, so a Device whose Call the object
     * has ended ends its own end of it.
     */
    private async callAlive(
      input: ConversationToolInput<"note_call_alive">,
      at: number,
    ): Promise<ToolResult<unknown>> {
      const sql = this.ctx.storage.sql;
      const call = callById(sql, input.call);
      if (call === null) return failure("not_found", NO_SUCH_CALL);
      if (call.ended === null) {
        noteAlive(sql, call.id, at);
        await this.keepAlarm();
        const spend = await this.deployment().beforeCall(this.spendReport(at), at);
        if (spend.notice === "cap_reached") {
          await this.endAtProvider(call.id, { at, ended: "cap_reached" }, CAP_SAID);
        }
      }
      return success({ call: this.callRecordOf(input.call) });
    }

    /**
     * End a Call going here because another has started in the Deployment: the Deployment object
     * asks, having named the new one the Call going. Not run behind the Call tools, since the one
     * starting may be one of them, waiting on the Deployment object.
     */
    async endReplaced(id: string, at: number): Promise<void> {
      if (this.#stuck !== null) return;
      await this.endAtProvider(id, { at, ended: "replaced" });
    }

    /**
     * End a Call whose session the Device has not heard end, if it still goes on: count it, then
     * end that session on the side channel, which drops every sound it is sent, having the voice
     * say `saying` first when given, and keep what the provider says as it does.
     */
    private async endAtProvider(
      id: string,
      end: { at: number; ended: CallEnd },
      saying?: string,
    ): Promise<void> {
      const sql = this.ctx.storage.sql;
      const call = callById(sql, id);
      if (call === null || !endCall(sql, id, { ...end, heard: null })) return;
      await this.reportCallEnded(id, end);
      const voice = voiceOf(this.env);
      if (voice !== null) keepEndHeardByObject(sql, id, await voice.end(call.session, saying));
    }

    /**
     * A Call has just ended: report what this Context has spent, the Call's cost in it, and tell
     * the Deployment object it is no longer going, which changes nothing there when another has
     * taken its place. A failure to reach it is counted with the next report, and the next Call to
     * start finds this one ended.
     */
    private async reportCallEnded(id: string, end: { at: number; ended: CallEnd }): Promise<void> {
      const deployment = this.deployment();
      try {
        await deployment.takeSpendReport(this.spendReport(end.at));
        await deployment.callEnded(this.contextId(), id);
      } catch {
        console.error(JSON.stringify({ call: "untold", told: "ended" }));
      }
    }

    /** The record of a Call this Context has, read as it stands now. */
    private callRecordOf(id: string): CallRecord {
      const now = callById(this.ctx.storage.sql, id);
      if (now === null) throw new Error("A Call read a moment ago is gone");
      return callRecord(now);
    }

    /**
     * End each Call going whose Device has sent no sign of life for `SIGN_OF_LIFE_LAPSE`, at the
     * provider itself, as at `at` (section 6): nothing rests on the Device.
     */
    private async endCallsUnheard(at: number): Promise<void> {
      for (const call of callsGoing(this.ctx.storage.sql)) {
        if (call.alive_at + SIGN_OF_LIFE_LAPSE <= at) {
          await this.endAtProvider(call.id, { at, ended: "no_sign_of_life" });
        }
      }
    }

    /**
     * Note that Praxis has shown a Brief or a Review in a focused window (section 5.4): it is read,
     * once for the Context, and every screen open on it hears so.
     */
    private async noteShown(
      agent: ContextAgent,
      id: string,
      at: number,
    ): Promise<ToolResult<unknown>> {
      if (!noteShown(this.ctx.storage.sql, id, at)) return noSuchBrief();
      await agent.carryMessage(this.ctx.storage, id);
      return success({ message: id, read: true });
    }

    /**
     * Try a failed Run again from the person's Message, as a new Run (section 5.6): only the
     * newest Message's, since one sent since has moved the Conversation on, and only once the
     * Deployment object says a Run may start, as for a Message.
     */
    private async retryRun(
      agent: ContextAgent,
      id: string,
      at: number,
    ): Promise<ToolResult<unknown>> {
      const sql = this.ctx.storage.sql;
      const failed = runById(sql, id);
      // A Run of a Conversation since cleared has no handle on it: nothing of it is there to try.
      if (
        failed === null ||
        failed.message === null ||
        failed.submission === null ||
        failed.started_by !== "message"
      ) {
        return failure("not_found", "There is no such Run in this Context's Conversation.");
      }
      if (failed.ended !== "failed") {
        return refusal(
          failed.ended === null
            ? "This Run is still going."
            : "This Run did not fail, so there is nothing to try again.",
          [],
        );
      }
      if (newestRun(sql)?.id !== failed.id) {
        return refusal(
          "Only the newest Message's Run can be tried again: a Message sent since has moved the Conversation on. Send this one again instead.",
          [],
        );
      }
      const allowed = await this.mayStartRun(agent, at);
      if (!allowed.ok) return allowed;
      const message = await agent.retry(this.ctx.storage, failed, at);
      if (message === null) {
        return refusal("A Run is going in this Conversation: try again once it has ended.", []);
      }
      return success({ message });
    }

    /**
     * Ask the Deployment object whether a Run may start, as at the start of every Run (section
     * 5.2), with the other Contexts' names. At the cap none starts: the Run not started still
     * leaves a record, and the call is refused with the cap in the way (section 5.7).
     */
    private async mayStartRun(
      agent: ContextAgent,
      at: number,
    ): Promise<ToolResult<{ otherContexts: string[] }>> {
      const { otherContexts, spend } = await this.deployment().beforeRun(
        this.ctx.id.toString(),
        at,
      );
      if (spend.notice === "cap_reached") {
        recordRunNotStarted(this.ctx.storage.sql, { at, model: agent.model });
        return capRefusal(spend.cap);
      }
      // The Agent's calls are timed by the clock the caller's requests arrive by.
      this.#clockSkew = at - arrivalTime();
      return success({ otherContexts });
    }

    /**
     * Start a Run for the person's Message, once the Deployment object has said one may: at the
     * cap none starts, and the Message is refused and kept nowhere.
     */
    private async startRun(
      agent: ContextAgent,
      input: ConversationToolInput<"send_message">,
      at: number,
    ): Promise<ToolResult<unknown>> {
      const allowed = await this.mayStartRun(agent, at);
      if (!allowed.ok) return allowed;
      const message = await agent.send(
        this.ctx.storage,
        { words: input.words, spoken: input.spoken ?? false, at },
        this.bearings(at, allowed.value.otherContexts),
      );
      return success({ message });
    }

    /**
     * What the Agent is told at the start of a Run: the Context's Standing Entries with their
     * dates, today, this Context's name, and the other Contexts' names, which this object asks the
     * Deployment object for (section 5.2); and with each Message, the Held Changes still waiting,
     * what others changed since the last Message it answered, and whether the Run answering that
     * one was cut short at the limit of model rounds. They are read as they stand when the Message is sent.
     */
    private bearings(at: number, otherContexts: string[]): Bearings {
      const sql = this.ctx.storage.sql;
      return {
        ...this.clockBearings(at, otherContexts),
        held: heldWaiting(sql, HELD_NAMED),
        digest: changesByOthers(sql, lastToldChange(sql), DIGEST_CHANGES),
        lastRunCutShort: newestRun(sql)?.ended === "cut_short",
      };
    }

    /**
     * What every Run is told at its start (section 5.2), and all a Brief or a Review is: today,
     * this Context's name and the others', and its Standing Entries.
     */
    private clockBearings(at: number, otherContexts: string[]): ClockBearings {
      const sql = this.ctx.storage.sql;
      const settings = readSettings(sql, at);
      return {
        today: settings.today,
        context: settings.name,
        otherContexts,
        standing: standingEntries(sql, settings.time_zone),
      };
    }

    /** The Deployment object this Context was made by, which it asks things of (section 9.2). */
    private deployment() {
      const kept = deploymentOfContext(this.ctx.storage.sql);
      return kept === null
        ? deploymentOf(this.env)
        : this.env.DEPLOYMENT.get(this.env.DEPLOYMENT.idFromString(kept));
    }

    /**
     * Whether this Context has an Agent, asked without opening it, so a Context keeps the model it
     * is first asked with in a Run.
     */
    private hasAgent(): boolean {
      const agent = this.#agent ?? modelOf(this.env);
      return typeof agent !== "string";
    }

    /**
     * The Agent of this Context with its Conversation open, or why there is none: the Deployment
     * has no Agent, or the runtime cannot open this Conversation's tables (section 11).
     */
    private async conversation(): Promise<ContextAgent | NoAgent | "unavailable"> {
      const agent = this.agent();
      if (typeof agent === "string") return agent;
      return (await agent.opens(this.ctx.storage)) ? agent : "unavailable";
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
                call: (tool, input, caller, wordsAnswered) =>
                  this.callAsAgent(tool, input, caller, wordsAnswered),
                sql: this.ctx.storage.sql,
                send: (message) => this.send(message),
                arm: (wake) => {
                  this.#agentWake = wake;
                  return this.keepAlarm();
                },
                reportKey: (report) => this.deployment().takeKeyReport(report),
                clockEnded: (run) => this.clockEnded(run),
                notify: (kind) => this.notify(kind),
                reportSpend: (at) => this.deployment().takeSpendReport(this.spendReport(at)),
              },
              model,
            );
      return this.#agent;
    }

    /**
     * A call from the Agent in a Run, or from the clock in a Brief or a Review, through the same
     * registry as every other caller, and the tools the object runs itself as it runs them for
     * every other caller: `search` waits on the meaning index (ADR 0023).
     */
    private async callAsAgent(
      tool: string,
      input: unknown,
      caller: Caller,
      wordsAnswered?: string,
    ): Promise<{ result: ToolResult<unknown>; change: number | null }> {
      const sql = this.ctx.storage.sql;
      const request: ToolRequest = {
        caller,
        tool,
        input,
        arrivedAt: arrivalTime() + this.#clockSkew,
        ...(wordsAnswered === undefined ? {} : { wordsAnswered }),
      };
      if (isObjectTool(tool)) {
        // A search takes up what is queued to embed, as one by any other caller does (`serve`).
        // None of these changes a record, so the Run gains no change by it, whatever another
        // caller wrote while it waited.
        this.keepMeaning();
        return { result: await this.runObjectTool(tool, request), change: null };
      }
      const elapsed = startTimer();
      const before = lastChange(sql);
      const result = dispatch(handlers, this.ctx.storage, request);
      logCall({ tool, write: isWrite(tool) }, result, elapsed());
      const after = lastChange(sql);
      if (after !== before) void this.afterWrite(before);
      return { result, change: after !== before ? after : null };
    }

    /**
     * After a write: carry what it added to the log live, embed what it queued for the meaning
     * index, and keep the alarm that prunes the log.
     */
    private async afterWrite(before: number): Promise<void> {
      this.carryChangesAfter(before);
      this.keepMeaning();
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
      if (this.#stuck !== null) {
        // No live channel opens: the screen reads why from any tool it calls.
        return new Response(`This Context is stuck on its upgrade: ${stuckWords(this.#stuck)}.`, {
          status: 503,
          headers: { "cache-control": "no-store" },
        });
      }
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

    /**
     * The platform fires the alarm by the real clock, and the object wakes by its own, which runs
     * from where the last request set it: the same when deployed. Tests call `wake` themselves.
     */
    async alarm(): Promise<void> {
      // Stuck, everything on its clock stops, and nothing arms it again until it comes back.
      if (this.#deleting || this.#stuck !== null) return;
      await this.wake(arrivalTime() + this.#clockSkew);
      this.keepMeaning();
      // A Run a lost instance left going, or one the runtime is waiting to retry, is taken up.
      const agent = await this.conversation();
      if (
        typeof agent !== "string" &&
        (this.#agentWake.active || runsNotEnded(this.ctx.storage.sql).length > 0)
      ) {
        await agent.wake(this.ctx.storage);
      }
      await this.keepAlarm();
    }

    /**
     * Everything the Context's clock does, as at `at`: forgetting keys past 30 days, removing for
     * good what has been in the Trash 30 days, pruning the change log at 90, finishing a move
     * interrupted, ending a Call whose Device has fallen silent, and starting a Brief or a Review
     * that is due.
     */
    async wake(at: number): Promise<void> {
      if (this.#stuck !== null) return;
      this.#clockStopped = false;
      const sql = this.ctx.storage.sql;
      this.#clockSkew = at - arrivalTime();
      this.ctx.storage.transactionSync(() => {
        forgetOldKeys(sql, at);
        forgetMovesTaken(sql, at);
        expireTrash(sql, at);
        pruneChanges(sql, at);
        pruneConnectionCalls(sql, at);
      });
      await this.finishMoves(at);
      await this.endCallsUnheard(at);
      await this.startClockRuns(at);
      await this.keepAlarm();
    }

    /** The clock's starts run one at a time, so two wakes never start one Brief twice. */
    #clocking: Promise<void> = Promise.resolve();

    /**
     * Start each Brief and Review due at `at` (section 5.4), unless one of its kind is going. At
     * the cap it waits, and one Run not started is recorded for it. Without the Agent's key none
     * is ever due.
     */
    private startClockRuns(at: number): Promise<void> {
      this.#clocking = this.#clocking.then(async () => {
        if (this.#deleting) return;
        const agent = await this.conversation();
        const sql = this.ctx.storage.sql;
        // A Conversation the runtime cannot open takes no Brief or Review until it can.
        if (agent === "unavailable") return;
        if (typeof agent === "string") return noClockWithoutAgent(sql, at);
        startSchedule(sql, at);
        const going = new Set(runsNotEnded(sql).map((run) => run.started_by));
        for (const { kind, due } of dueClockRuns(sql, readSettings(sql, at), at)) {
          if (going.has(kind)) continue;
          const { otherContexts, spend } = await this.deployment().beforeRun(
            this.ctx.id.toString(),
            at,
          );
          if (spend.notice === "cap_reached") {
            if (clockCapped(sql, kind, due, at)) {
              recordRunNotStarted(sql, { at, model: agent.model, startedBy: kind });
            }
            continue;
          }
          clockStarted(sql, kind, due);
          await agent.startClock(this.ctx.storage, kind, at, this.clockBearings(at, otherContexts));
        }
      });
      return this.#clocking;
    }

    /**
     * Ask the Deployment object to send a Brief's or Review's Notification to the Devices, when
     * this Context's switch is on. It is told the kind and nothing of what was said, and a failure
     * to reach it costs only the Notification.
     */
    private async notify(kind: ClockKind): Promise<void> {
      const at = arrivalTime() + this.#clockSkew;
      if (!readSettings(this.ctx.storage.sql, at).notifications) return;
      try {
        await this.deployment().notifyDevices(this.ctx.id.toString(), kind, at);
      } catch {
        console.error(JSON.stringify({ notify: "unreached", kind }));
      }
    }

    /** A Brief's or Review's Run has ended: the clock takes it from there, and keeps the alarm. */
    private async clockEnded(run: RunRow): Promise<void> {
      if (run.started_by === "message" || run.ended === null) return;
      clockEnded(this.ctx.storage.sql, run.started_by, {
        how: run.ended,
        failure: run.failure,
        at: run.at,
      });
      await this.keepAlarm();
    }

    /**
     * Wait until every Run in this Context has ended and its record says how. For tests, which
     * cannot see a Run end otherwise but on the live channel.
     */
    async runsEnded(): Promise<void> {
      const agent = await this.conversation();
      if (typeof agent !== "string") await agent.runsEnded(this.ctx.storage);
    }

    /**
     * Keep the alarm armed for the earliest thing this object has to do: the Agent's runtime,
     * while it works or sleeps, and the daily pruning while there is something to prune.
     */
    private async keepAlarm(): Promise<void> {
      if (this.#deleting) return;
      const storage = this.ctx.storage;
      // The object's time, which a test sets; the platform's alarm is set by the real clock.
      const skew = this.#clockSkew;
      const now = arrivalTime() + skew;
      const wanted: number[] = [];
      if (
        holdsKeys(storage.sql) ||
        holdsChanges(storage.sql) ||
        holdsConnectionCalls(storage.sql)
      ) {
        wanted.push(now + ALARM_GAP);
      }
      const expiry = nextExpiry(storage.sql);
      if (expiry !== null) wanted.push(expiry);
      if (this.#agentWake.active) wanted.push(now + RUN_HEARTBEAT);
      if (this.#agentWake.at !== undefined) wanted.push(this.#agentWake.at + skew);
      if (this.#meaningStopped && anythingQueued(storage.sql)) wanted.push(now + MEANING_RETRY);
      if (movesOut(storage.sql).length > 0) wanted.push(now + MOVE_RETRY);
      // A Call going ends once its Device has been silent too long: at once, when it has been.
      for (const call of callsGoing(storage.sql)) {
        wanted.push(Math.max(now, call.alive_at + SIGN_OF_LIFE_LAPSE));
      }
      // Without the Agent's key, no Brief or Review is ever due.
      if (
        this.hasAgent() &&
        storage.sql.exec(`SELECT 1 FROM context_settings`).toArray().length > 0
      ) {
        const clock = nextClockWake(storage.sql, readSettings(storage.sql, now), now);
        if (clock !== null) wanted.push(clock);
      }
      const set = await storage.getAlarm();
      if (wanted.length === 0) return;
      const earliest = Math.min(...wanted) - skew;
      // The daily wake is kept as it was set; only something sooner moves it.
      if (set === null || earliest < set) await storage.setAlarm(earliest);
    }
  };
}
