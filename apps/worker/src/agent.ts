import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { AssistantMessage, Message as ModelMessage } from "@earendil-works/pi-ai";
import {
  CompactionTask,
  type Conversation,
  createRegistry,
  defineExtension,
  defineTool,
  type EntryRecord,
  GenerationTask,
  Harness,
  type HookApi,
  hook,
  LiveDoc,
  type LiveState,
  type Report,
  type Submission,
  type SubmissionId,
  section,
  type Wake,
} from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import {
  type AgentMessage,
  type Caller,
  type Change,
  type ClockFold,
  type ClockKind,
  type Effect,
  inputJsonSchema,
  instantToIso,
  type LiveMessage,
  type Message,
  type MessagesPage,
  offeredTo,
  type PersonMessage,
  type RunCall,
  type RunFailure,
  type RunStart,
  type ToolName,
  type ToolResult,
  tools,
} from "@praxis/domain";
import { type Digest, encodeCursor } from "./change-log.ts";
import { finishedSince, settleClockRun } from "./clock-rows.ts";
import { summaryRequest } from "./compaction.ts";
import { type HeldWaiting, heldWaiting } from "./held-change-rows.ts";
import { type AgentModel, costOf, runFailure } from "./model.ts";
import type { KeyReport } from "./notice-rows.ts";
import {
  addRunChange,
  addRunSpend,
  endRun,
  type RunRow,
  type RunSpend,
  runAnswering,
  runById,
  runsAnswering,
  runsNotEnded,
  startRun,
} from "./run-rows.ts";
import type { StandingEntry } from "./standing-rows.ts";

/**
 * The Agent of one Context (section 5): Pi Durable, running inside the Context's object over its
 * SQLite (ADR 0024). The runtime's tables, under `pi_`, hold only the Conversation; Praxis's own
 * hold the domain and the Run records. There is one continuing Conversation, the runtime's root.
 * How it is wired, and the runtime's gotchas: docs/pi-durable.md.
 */

/** The prefix of the runtime's tables in the Context's database. */
export const RUNTIME_TABLES = "pi_";

/**
 * The kind of record the runtime keeps a Message from the person as, in its transcript. Its data
 * holds what the screen shows. (The runtime calls its records entries; they are never Entries.)
 */
const MESSAGE_KIND = "praxis.message";
type MessageData = { id: string; words: string; spoken: boolean; at: number };

/**
 * The kind of record the runtime keeps the clock starting a Brief or a Review as. Its data says
 * which and when; the model is shown the clock's instructions. It is not a Message from the person.
 */
const CLOCK_KIND = "praxis.clock";
type ClockData = { id: string; kind: ClockKind; at: number };

/** What each Agent call left beside its result for the screen: the result's code and its Effects. */
type CallDetails = { result: RunCall["result"]; effects: Effect[] };

/** What the Agent needs from the Context's object. */
export type AgentHost = {
  /**
   * Call a Context tool as the Agent, or as the clock in a Brief or a Review, through the
   * registry, at the time it arrives. A write is given the key the runtime gave the call. Returns
   * the result and the change it logged, if any.
   */
  call(
    tool: ToolName,
    input: unknown,
    caller: Caller,
  ): { result: ToolResult<unknown>; change: number | null };
  /** The Context's own SQLite, for the Run records. */
  sql: SqlStorage;
  /** Carry something down every live channel open on the Context. */
  send(message: LiveMessage): void;
  /** Keep the object's alarm armed for what the runtime says it needs next. */
  arm(wake: Wake): Promise<void>;
  /**
   * Tell the Deployment object what this Context's Runs have spent in the calendar month `at`
   * falls in, so it counts against the cap.
   */
  reportSpend(at: number): Promise<void>;
  /**
   * Tell the Deployment object the provider refused the key in a Run started at `at`, or took it
   * in one: a refused key is a standing Notice in every Context until a call succeeds (section
   * 5.6).
   */
  reportKey(report: KeyReport): Promise<void>;
  /** A Brief's or Review's Run has ended and its record says how: the clock takes it from there. */
  clockEnded(run: RunRow): Promise<void>;
};

/**
 * What the Agent is told at the start of every Run, beside the person's Message (section 5.2). The
 * Worker hands it nothing: the Context's object asks for the other Contexts' names itself.
 */
export type Bearings = {
  today: string;
  context: string;
  otherContexts: string[];
  /** The Context's Standing Entries, oldest first, each with its day (section 5.5). */
  standing: StandingEntry[];
  /** The Held Changes still waiting, named, and how many more than are named (section 4.7). */
  held: HeldWaiting;
  /** What others changed since the last Message the Agent answered (section 4.4). */
  digest: Digest;
  /** Whether the Run answering the newest Message before this one was cut short (section 5.2). */
  lastRunCutShort: boolean;
};

/** How many waiting Held Changes a Message names; the rest the Agent lists for itself. */
export const HELD_NAMED = 20;

/** How many changes the digest of a Message names; the earlier ones the Agent reads for itself. */
export const DIGEST_CHANGES = 30;

/**
 * Who the Agent is and how it works, the same every Run, so the model's prompt cache holds. What
 * changes each Run is given with the person's Message.
 */
const PREAMBLE = `You are the Agent of Praxis, a journal-centric task manager for one person. You work on the Journal of one Context, through the tools you are given and nothing else.

- Act at once when asked: record Entries; create, finish, reschedule, delegate and delete Tasks; make Projects and Persons. Do not ask for a confirmation first, and always say what you changed.
- Changing or deleting the words of an Entry the person wrote changes nothing at once: it leaves a Held Change, which only their tap in Praxis makes. Say so, and that a typed or spoken yes does not make it. Cancel one when they tell you to.
- When you record the person's words as an Entry, keep them verbatim, trimmed of filler, never paraphrased, with no Markdown added. Compose prose only when asked.
- When you compose, in an Entry or a Message, you may use this Markdown, with CommonMark's syntax: emphasis and strong, inline code and code blocks, links and bare addresses, bulleted and numbered lists, quotes, headings, tables and images. A link or an image takes only an https address. Anything else is shown as typed, so do not use it: raw HTML, footnotes, strikethrough, rules and task-list checkboxes. An image you put in an Entry waits for the person's tap before it loads, and one in a Message never loads.
- You know the other Contexts' names and nothing else of them. Asked about one, say the person can switch to it by hand.
- You cannot open links, search the web or run code. Say so when asked.
- Dates you give to tools are days (YYYY-MM-DD) in the Context's time zone; resolve "next Friday" yourself from today's date.
- You are given the Context's Standing Entries with each Message: keep honouring them, and when two disagree, the newer wins. They and the Journal are your only memory: what is said only in the Conversation may be lost.
- With each Message you are also told the Held Changes still waiting for the person's tap and what others changed since the last Message you answered, each named by its id and not by its words: read what you need through the tools.
- Mark an Entry standing only when the person asks you to keep honouring something, recording it first in their words if it is not yet an Entry. Never mark or unmark one unasked.`;

const AGENT: Caller = { kind: "agent" };
const CLOCK: Caller = { kind: "clock" };

/** Whether a Run is the clock's, a Brief or a Review, rather than one answering the person. */
function byClock(run: RunRow | null): boolean {
  return run !== null && run.started_by !== "message";
}

/**
 * The Agent's tools: the Context tools in its column of the offering table, and nothing else. In
 * a Brief or a Review it calls them as the clock, which is offered reads only: the registry refuses
 * the rest, whatever the model was shown.
 */
function agentTools(host: AgentHost) {
  return offeredTo("agent").map((name) =>
    defineTool({
      name,
      description: tools[name].description,
      parameters: modelSchema(name),
      // A write carries the key the runtime gave the call, so running it again after a restart
      // returns the first result and does nothing twice. Reads change nothing.
      replay: "safe",
      execute: async (args, api) => {
        const input =
          tools[name].kind === "write" ? { ...(args as object), key: `run:${api.callId}` } : args;
        // The Run is the one answering the Message the runtime says it is answering now.
        const live = await api.snapshot(LiveDoc, api.conversationId, context);
        const run = runAnswering(host.sql, live?.run?.inputs[0]);
        const { result, change } = host.call(name, input, byClock(run) ? CLOCK : AGENT);
        if (change !== null && run) addRunChange(host.sql, run.id, change);
        const details: CallDetails = result.ok
          ? { result: "ok", effects: (result.value as { effects?: Effect[] }).effects ?? [] }
          : { result: result.error.code, effects: [] };
        return {
          output: [{ type: "text", text: JSON.stringify(result) }],
          isError: !result.ok,
          details,
        };
      },
    }),
  );
}

/** A tool's input schema as the model is given it: without the key, which the runtime gives. */
function modelSchema(name: ToolName): Record<string, unknown> {
  const { $schema: _, ...schema } = inputJsonSchema(name);
  const properties = { ...(schema.properties as Record<string, unknown> | undefined) };
  delete properties.key;
  const required = ((schema.required as string[] | undefined) ?? []).filter((n) => n !== "key");
  return { ...schema, properties, required };
}

/**
 * The Message as the model is shown it: the Run's bearings, then the person's words, last and
 * alone. `personsWords` reads them back, so the format has one owner.
 */
function presented(words: string, bearings: Bearings): string {
  // The Standing Entries are bearings too, so the person's words come last and alone.
  return `<bearings>
${placePresented(bearings)}${bearings.lastRunCutShort ? `\n\nYour last Run was cut short at the limit of ${RUN_ROUNDS.message} model rounds, before you had finished: the person may want you to carry on.` : ""}

${standingPresented(bearings.standing)}

${heldPresented(bearings.held)}

${digestPresented(bearings.digest)}
${BEARINGS_END}${words}`;
}

/** Today, this Context and the others, as every Run is told them. */
function placePresented({ today, context, otherContexts }: ClockBearings): string {
  const others =
    otherContexts.length === 0
      ? "There are no other Contexts."
      : `The other Contexts are: ${otherContexts.map((name) => JSON.stringify(name)).join(", ")}.`;
  return `Today is ${today}. This Context is ${JSON.stringify(context)}. ${others}`;
}

/**
 * What a Brief or a Review is given at its start (section 5.2): today, this Context's name and the
 * others', and its Standing Entries. It answers no Message, so it is told no Held Change or digest.
 */
export type ClockBearings = Pick<Bearings, "today" | "context" | "otherContexts" | "standing">;

/** What the Agent answers with in a Brief that has nothing to raise, which leaves no Message. */
export const NOTHING_TO_RAISE = "NOTHING_TO_RAISE";

/** What a Review that answered with `NOTHING_TO_RAISE` says, in Praxis's words. */
const NOTHING_STALE = "Nothing has gone stale or been missed this week.";

/**
 * How a Brief or a Review ends its answer: the ids of the Tasks it raises, which Praxis takes off
 * before showing it, to say once any have been finished since.
 */
const TASKS_NAMED = /\n*<tasks_named>([^<]*)<\/tasks_named>\s*$/;

/** What the clock asks of the Agent in a Brief and in a Review (section 5.4). */
const CLOCK_ASKS: Record<ClockKind, string> = {
  brief: `The clock started this Run for this Context's Brief: no Message from the person started it. Read the Journal through your tools, beginning with view_attention, and leave one Message saying what needs attention today: what is due, what became actionable, and what is Delegated or Waiting and has gone quiet, which is your judgment from the Journal. If there is nothing to raise, answer with exactly ${NOTHING_TO_RAISE} and nothing else.`,
  review: `The clock started this Run for this Context's weekly Review: no Message from the person started it. Read the Journal through your tools and leave one Message listing stale Tasks, Projects with no next Task, and Entries that look like they hold a Task nobody made. If there is nothing to raise, say so in one line.`,
};

/** The clock's instructions as the model is shown them, after the Run's bearings. */
function clockPresented(kind: ClockKind, bearings: ClockBearings): string {
  return `<bearings>
${placePresented(bearings)}

${standingPresented(bearings.standing)}
${BEARINGS_END}${CLOCK_ASKS[kind]}

You can only read in this Run: you cannot change anything or leave a Held Change. If you think something should change, say so. You see the Journal only: do not mention a calendar or apologise for lacking one. Be brief. End your Message with the ids of the Tasks it raises, on a line of their own, as <tasks_named>id id</tasks_named>, or <tasks_named></tasks_named> when it raises none.`;
}

/**
 * A Brief's or Review's answer as the screen shows it, without the Tasks it names, and those
 * Tasks' ids.
 */
export function clockAnswer(words: string): { shown: string; tasksNamed: string[] } {
  const found = TASKS_NAMED.exec(words);
  if (!found) return { shown: words.trim(), tasksNamed: [] };
  return {
    shown: words.slice(0, found.index).trim(),
    tasksNamed: (found[1] ?? "").split(/[\s,]+/).filter((id) => id !== ""),
  };
}

/**
 * What changed since the last Message the Agent answered, as the model is shown it: each change by its caller and
 * tool, each of its Effects naming what it changed by kind and id. None of the words: the Agent
 * reads what it needs through the tools, so what it knew shows in its calls.
 */
function digestPresented(digest: Digest): string {
  const { items, earlier, after, pruned, told } = digest;
  const heading = !told
    ? items.length === 0
      ? "Nobody else has changed anything yet."
      : "You have not been told before what others changed. The newest changes they made, oldest first:"
    : items.length === 0
      ? "Nobody else has changed anything since the last Message you answered."
      : "What others changed since the last Message you answered, oldest first:";
  const lines = [heading, ...items.map(changePresented)];
  if (earlier > 0) {
    lines.push(
      `${earlier} earlier ${earlier === 1 ? "change is" : "changes are"} not shown: list_changes from the cursor "${encodeCursor(after)}" gives them.`,
    );
  }
  if (pruned)
    lines.push(
      "Some changes since the last Message you answered are older than the change log keeps.",
    );
  return lines.join("\n");
}

function changePresented({ at, caller, tool, effects }: Change): string {
  const who =
    "name" in caller ? `the Connection ${JSON.stringify(caller.name)}` : CALLER_NAMED[caller.kind];
  const what = effects
    .map(({ kind, id, what, by }) => `${kind} ${id} ${what}${by === "rule" ? " by rule" : ""}`)
    .join("; ");
  return `<change at="${at}" by="${who}" tool="${tool}">${what}</change>`;
}

const CALLER_NAMED = { hand: "the person", agent: "you", clock: "the clock" } as const;

/** The Held Changes still waiting as the model is shown them: each named, none of its words. */
function heldPresented({ items, more }: HeldWaiting): string {
  if (items.length === 0) return "No Held Change is waiting for the person's tap.";
  const named = items.map(
    ({ id, summary, entry }) => `<held_change id="${id}" entry="${entry}">${summary}</held_change>`,
  );
  const rest =
    more === 0
      ? ""
      : `\n${more} more ${more === 1 ? "waits" : "wait"}: list_held_changes lists them all.`;
  return `The Held Changes still waiting for the person's tap, oldest first:\n${named.join("\n")}${rest}`;
}

/** Where the bearings end and the person's words begin, in a Message as the model is shown it. */
const BEARINGS_END = "</bearings>\n\n";

/**
 * The person's words in a Message as `presented` showed it to the model, without the bearings:
 * for a scripted model to act on what the person asked (section 13).
 */
export function personsWords(message: string): string {
  if (!message.startsWith("<bearings>")) return message;
  const end = message.indexOf(`\n${BEARINGS_END}`);
  return end === -1 ? message : message.slice(end + 1 + BEARINGS_END.length);
}

/** The Standing Entries as the model is shown them: each its own block, with its id and day. */
function standingPresented(standing: StandingEntry[]): string {
  if (standing.length === 0) return "There are no Standing Entries in this Context.";
  const entries = standing.map(
    ({ id, day, words }) => `<standing_entry id="${id}" day="${day}">\n${words}\n</standing_entry>`,
  );
  return `The Standing Entries of this Context, oldest first:\n\n${entries.join("\n\n")}`;
}

const context = BACKGROUND_CONTEXT;

/** The Agent of a Context, opened on first use and kept while the object is. */
export class ContextAgent {
  readonly #host: AgentHost;
  readonly #model: AgentModel;
  #opened: Promise<{ harness: Harness; root: Conversation }> | null = null;
  /**
   * The answer of the Run going now, as carried down the live channel: what earlier rounds said,
   * and what this one is saying so far.
   */
  #answer: { run: unknown; said: string[]; saying: string } = {
    run: undefined,
    said: [],
    saying: "",
  };
  /** The Runs being waited on to end, so their records say how. */
  readonly #settling = new Set<Promise<void>>();
  /** The limit of model rounds the Conversation was last configured with. */
  #maxTurns: number | undefined;

  constructor(host: AgentHost, model: AgentModel) {
    this.#host = host;
    this.#model = model;
  }

  /** The model's name, as the Run records keep it. */
  get model(): string {
    return this.#model.id;
  }

  /** Open the runtime on the Context's SQLite, and take up any Run a lost instance left going. */
  open(storage: DurableObjectStorage): Promise<{ harness: Harness; root: Conversation }> {
    this.#opened ??= this.#open(storage);
    return this.#opened;
  }

  async #open(storage: DurableObjectStorage) {
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "praxis",
        tools: agentTools(this.#host),
        sections: [section("preamble", () => PREAMBLE, { tag: false })],
        // Praxis supplies the summary that stands in for the older Conversation (section 5.5).
        hooks: [
          hook(CompactionTask, {
            beforeCompact: (compaction, api, within) => this.#summarize(compaction, api, within),
          }),
          // The limit of model rounds and the tools offered are the Run's: the clock's are its own.
          hook(GenerationTask, {
            beforeRequest: (request, api, within) => this.#fitRequest(request, api, within),
          }),
        ],
      }),
    );
    const harness = await Harness.open(
      await openDurableObjectSqliteStorage(storage, { prefix: RUNTIME_TABLES }),
      {
        models: this.#model.models,
        registry,
        // The host arms the object's alarm, and calls `resume` when it fires.
        onWake: (wake) => void this.#host.arm(wake),
        settings: {
          // A Run's calls run in the order the model made them.
          toolExecution: "sequential",
          // One Message per Run: each answers one, in the order they were sent.
          followUpMode: "one-at-a-time",
          // A model not reached is asked again for seconds, by Praxis's policy alone: the
          // provider's own client asks no more times inside each.
          retry: { enabled: true, ...this.#model.retry },
          stream: { maxRetries: 0 },
          // A Message queued behind a failed Run is answered in its turn, as after an answer, so
          // it stays in the Conversation with a Notice of its own if it fails too. Nothing waits
          // to be answered later by itself.
          afterFailedRun: "continue",
          // Compacted only inside a Run, as it is about to ask the model, so what writing the
          // summary costs is that Run's. The model may narrow the window, as a scripted one does.
          compaction: { backgroundTokens: 0, ...this.#model.compaction },
        },
        // The runtime's own failures, by kind and never with what was said (ADR 0010).
        onReport: (report: Report) => console.error(JSON.stringify({ agent: report.kind })),
      },
      context,
    );
    const agent = {
      model: { provider: this.#model.provider, modelId: this.#model.id },
      maxTurns: RUN_ROUNDS.message,
    };
    const root = await harness.root(context, { agent });
    // A deploy may have changed the model or the limit: the Conversation follows them.
    const current = await root.agent(context);
    if (
      current.model?.provider !== agent.model.provider ||
      current.model.modelId !== agent.model.modelId ||
      current.maxTurns !== agent.maxTurns
    ) {
      await root.configure(agent, context);
    }
    this.#maxTurns = agent.maxTurns;
    await harness.observeDoc(
      LiveDoc,
      root.id,
      {
        advance: (call) => {
          if (call.kind === "value") this.#carryAnswer(call.value);
        },
        end: () => {},
      },
      context,
    );
    await this.#host.arm(harness.wake());
    harness.resume();
    for (const run of runsNotEnded(this.#host.sql)) this.#follow(harness, root, run);
    return { harness, root };
  }

  /**
   * Fit a request to the Run it is for: a Brief or a Review is limited to the clock's rounds and
   * offered reads only, and one answering the person to the person's rounds and the Agent's tools.
   * The limit is the Conversation's, read once the round's tools have run, so it is configured
   * here, before the round. Never throws: a hook that throws is skipped (docs/pi-durable.md).
   */
  async #fitRequest(
    request: { readonly messages: readonly ModelMessage[] },
    api: HookApi,
    within: Context,
  ): Promise<{ messages: readonly ModelMessage[] } | undefined> {
    try {
      const live = await api.snapshot(LiveDoc, api.conversationId, within);
      const clock = byClock(runAnswering(this.#host.sql, live?.run?.inputs[0]));
      const limit = clock ? RUN_ROUNDS.clock : RUN_ROUNDS.message;
      if (limit !== this.#maxTurns) {
        const { root } = await (this.#opened as Promise<{ root: Conversation }>);
        await root.configure({ maxTurns: limit }, within);
        this.#maxTurns = limit;
      }
      if (!clock) return undefined;
      return {
        messages: request.messages.map((message) =>
          message.role === "system" && message.toolsAdded !== undefined
            ? {
                ...message,
                toolsAdded: message.toolsAdded.filter(({ name }) =>
                  CLOCK_TOOLS.has(name as ToolName),
                ),
              }
            : message,
        ),
      };
    } catch {
      console.error(JSON.stringify({ agent: "request_not_fitted" }));
      return undefined;
    }
  }

  /**
   * Start a Brief or a Review as at `at`, after any Run going now: the clock's record goes into the
   * Conversation in place of a Message, and the Run is recorded before it starts.
   */
  async startClock(
    storage: DurableObjectStorage,
    kind: ClockKind,
    at: number,
    bearings: ClockBearings,
  ): Promise<void> {
    const { harness, root } = await this.open(storage);
    const data: ClockData = { id: crypto.randomUUID(), kind, at };
    await this.#host.arm({ ...harness.wake(), active: true });
    const submission = await root.submit(
      {
        type: "input",
        content: clockPresented(kind, bearings),
        entry: { kind: CLOCK_KIND, data },
        requestId: data.id,
      },
      context,
    );
    const run = startRun(this.#host.sql, {
      startedBy: kind,
      message: data.id,
      submission: submission.id,
      at,
      model: this.#model.id,
    });
    this.#follow(harness, root, run);
  }

  /** The runtime fired the alarm: run what is due, and what a lost instance left. */
  async wake(storage: DurableObjectStorage): Promise<void> {
    const { harness } = await this.open(storage);
    await this.#host.arm({ ...harness.wake(), active: true });
    harness.resume();
  }

  /**
   * Add the person's Message to the Conversation and start a Run for it, after any going now. The
   * Run is recorded before it starts, and its record says how it ended once it has.
   */
  async send(
    storage: DurableObjectStorage,
    message: { words: string; spoken: boolean; at: number },
    bearings: Bearings,
  ): Promise<PersonMessage> {
    const { harness, root } = await this.open(storage);
    const data: MessageData = { id: crypto.randomUUID(), ...message };
    // Armed before anything can start, so an object evicted mid-Run is woken to finish it.
    await this.#host.arm({ ...harness.wake(), active: true });
    const submission = await root.submit(
      {
        type: "input",
        content: presented(message.words, bearings),
        entry: { kind: MESSAGE_KIND, data },
        requestId: data.id,
      },
      context,
    );
    const run = startRun(this.#host.sql, {
      startedBy: "message",
      message: data.id,
      submission: submission.id,
      at: message.at,
      model: this.#model.id,
      toldThrough: bearings.digest.through,
    });
    this.#follow(harness, root, run);
    const sent = personMessage(data);
    this.#host.send({ kind: "message", message: sent });
    return sent;
  }

  /**
   * Try a failed Run again from the person's Message it answered, as a new Run on the
   * Conversation as it stands, which ends in that Message. Null when the runtime is busy with a
   * Run, or the Message is not the newest. The Message is carried down without its Notice.
   */
  async retry(
    storage: DurableObjectStorage,
    failed: RunRow,
    at: number,
  ): Promise<PersonMessage | null> {
    const { harness, root } = await this.open(storage);
    const [newest] = (await this.page(root, undefined, 2)).items.filter(
      (message): message is PersonMessage => message.from === "person",
    );
    if (newest?.id !== failed.message) return null;
    const last = (await root.entries({ order: "descending" }, 1, undefined, context)).items[0];
    await this.#host.arm({ ...harness.wake(), active: true });
    let submission: Submission;
    try {
      submission = await root.submit({ type: "continue", requestId: crypto.randomUUID() }, context);
    } catch {
      // A Run is going, which a continue never waits behind.
      return null;
    }
    const run = startRun(this.#host.sql, {
      startedBy: "message",
      message: newest.id,
      submission: submission.id,
      at,
      model: this.#model.id,
      fromRecord: last === undefined ? 1 : (last.id as number) + 1,
    });
    this.#follow(harness, root, run);
    const retried: PersonMessage = { ...newest, notice: null };
    this.#host.send({ kind: "message", message: retried });
    return retried;
  }

  /** Every Run going or waiting has ended, and its record says how. */
  async runsEnded(storage: DurableObjectStorage): Promise<void> {
    await this.open(storage);
    while (this.#settling.size > 0) await Promise.all(this.#settling);
  }

  #follow(harness: Harness, root: Conversation, run: RunRow): void {
    const settling = this.#settle(harness, root, run).finally(() =>
      this.#settling.delete(settling),
    );
    this.#settling.add(settling);
  }

  /**
   * Wait for a Run to end, then record how, why if it failed, and what it spent, and carry its
   * Message down: the Agent's, and the person's with its Notice if it failed.
   */
  async #settle(harness: Harness, root: Conversation, run: RunRow): Promise<void> {
    const submission = await harness.submission(run.submission as SubmissionId, context);
    if (!submission) {
      endRun(
        this.#host.sql,
        run.id,
        { how: "failed", failure: "model_unavailable" },
        NOTHING_SPENT,
      );
      await this.#reportSpend(run.at);
      await this.#clockEnded(run);
      return;
    }
    const settled = await submission.wait(context);
    // A Run that reached the limit of model rounds was cut short, which is not a failure.
    const cutShort = settled.status !== "done" && settled.reason === ROUNDS_REACHED;
    const failure =
      settled.status === "done" || cutShort ? null : runFailure(settled.reason, settled.detail);
    // Why, by the runtime's code and never its detail, which may quote what was said (ADR 0010).
    if (failure !== null) {
      console.error(JSON.stringify({ agent: "run_failed", reason: settled.reason, failure }));
    }
    // A Run trying a failed one again places no Message: its records start where it started.
    const first = settled.entry ?? run.from_record;
    const records = first === undefined || first === null ? [] : await runRecords(root, first);
    endRun(
      this.#host.sql,
      run.id,
      { how: cutShort ? "cut_short" : failure === null ? "answered" : "failed", failure },
      spendOf(
        run.model,
        records.flatMap((record) => record.model ?? []),
      ),
    );
    if (run.started_by !== "message") {
      const kind = run.started_by;
      const { shown, tasksNamed } = clockAnswer(saidIn(records));
      // A Brief with nothing to raise leaves no Message, and a Review always leaves one; one cut
      // short says so whatever it said.
      const raised =
        cutShort ||
        (failure === null && shown !== "" && (kind === "review" || shown !== NOTHING_TO_RAISE));
      settleClockRun(this.#host.sql, { id: run.id, kind }, { raised, tasksNamed });
      // A Brief or Review that left a Message notifies the Devices, by the Deployment object (#68).
    }
    // Counted before the screen learns the Run ended, so the spend it reads then holds it.
    await this.#reportSpend(run.at);
    if (failure === "key_refused") await this.#reportKey({ key: "refused", at: run.at });
    else if (reachedModel(records)) await this.#reportKey({ key: "taken", at: run.at });
    // A Message sent meanwhile may already be newer than this Run's.
    const recent = (await this.page(root, undefined, RECENT_MESSAGES)).items;
    const answer = recent.find((message) => message.from === "agent" && message.run.id === run.id);
    if (answer) this.#host.send({ kind: "message", message: answer });
    const noticed = recent.find(
      (message) => message.from === "person" && message.notice?.run === run.id,
    );
    if (noticed) this.#host.send({ kind: "message", message: noticed });
    await this.#clockEnded(run);
  }

  /** Hand a Brief's or Review's Run, now ended, back to the clock, as its record now says. */
  async #clockEnded(run: RunRow): Promise<void> {
    if (!byClock(run)) return;
    const ended = runById(this.#host.sql, run.id);
    if (ended) await this.#host.clockEnded(ended);
  }

  /**
   * Write the summary that stands in for the older Conversation once it is compacted (section
   * 5.5): the model writes what is in flight on Praxis's instructions, and the Held Changes still
   * waiting are added here, named. What it costs counts in the Run it was written in. When the
   * model cannot write one, nothing is compacted this time, and the request that follows decides
   * how the Run goes: the runtime's own summary, which a throw here would fall back to, is never
   * used.
   */
  async #summarize(
    compaction: { readonly messages: readonly ModelMessage[] },
    api: HookApi,
    within: Context,
  ): Promise<{ summary: string } | { decline: true }> {
    try {
      return await this.#writeSummary(compaction.messages, api, within);
    } catch {
      console.error(JSON.stringify({ agent: "summary_not_written" }));
      return { decline: true };
    }
  }

  async #writeSummary(
    messages: readonly ModelMessage[],
    api: HookApi,
    within: Context,
  ): Promise<{ summary: string } | { decline: true }> {
    const { models, provider, id } = this.#model;
    const model = models.getModel(provider, id);
    if (!model) return { decline: true };
    const answer = await models.completeSimple(
      model,
      { messages: summaryRequest(withoutBearings(messages), messages.at(-1)?.timestamp ?? 0) },
      { maxTokens: SUMMARY_TOKENS },
    );
    const live = await api.snapshot(LiveDoc, api.conversationId, within);
    const run = runAnswering(this.#host.sql, live?.run?.inputs[0]);
    if (run) addRunSpend(this.#host.sql, run.id, spendOf(run.model, [answer]));
    else console.error(JSON.stringify({ agent: "summary_spend_not_counted" }));
    const words = textOf(answer);
    if (answer.stopReason !== "stop" || words === "") {
      console.error(JSON.stringify({ agent: "summary_not_written", stop: answer.stopReason }));
      return { decline: true };
    }
    const held = heldPresented(heldWaiting(this.#host.sql, HELD_NAMED));
    return { summary: `${words}\n\n${held}` };
  }

  /** Report whether the key was refused. One that fails is made good by the next Run's. */
  async #reportKey(report: KeyReport): Promise<void> {
    try {
      await this.#host.reportKey(report);
    } catch {
      console.error(JSON.stringify({ agent: "key_not_reported" }));
    }
  }

  /**
   * Report the month's spend. A report is the month's whole total, so one that fails is made good
   * by the next Run's.
   */
  async #reportSpend(at: number): Promise<void> {
    try {
      await this.#host.reportSpend(at);
    } catch {
      console.error(JSON.stringify({ agent: "spend_not_reported" }));
    }
  }

  /**
   * Carry the answer being written down the live channel, all of it so far, as it grows. A Run
   * may answer over several rounds of the model, between its calls: what an earlier round said
   * is kept before what this one is saying.
   */
  #carryAnswer(live: Readonly<LiveState>): void {
    // A Run is the one answering a Message: its task is handed on from round to round.
    const run = live.run?.inputs[0];
    // A Brief or a Review arrives whole, once it is known to have something to raise.
    if (byClock(runAnswering(this.#host.sql, run))) return;
    if (run !== this.#answer.run) this.#answer = { run, said: [], saying: "" };
    const message = live.generation?.message as AssistantMessage | undefined;
    const words = message ? textOf(message) : "";
    const { said, saying } = this.#answer;
    // A round that ended, or a new one that does not go on from it.
    if (saying !== "" && !words.startsWith(saying)) said.push(saying);
    this.#answer.saying = words;
    if (words === "" || words === saying) return;
    this.#host.send({ kind: "answer", words: [...said, words].join("\n\n") });
  }

  /**
   * Carry a Message of the Conversation down the live channel as it now stands, when it is among
   * the newest: a Brief or a Review just read, so every screen open on the Context shows it read.
   */
  async carryMessage(storage: DurableObjectStorage, id: string): Promise<void> {
    const { root } = await this.open(storage);
    const message = (await this.page(root, undefined, PAGE_MESSAGES)).items.find(
      (each) => each.id === id,
    );
    if (message) this.#host.send({ kind: "message", message });
  }

  /** The Conversation, newest Message first, from the start of a page the cursor names. */
  async messages(storage: DurableObjectStorage, cursor: string | undefined): Promise<MessagesPage> {
    const { root } = await this.open(storage);
    return this.page(root, cursor, PAGE_MESSAGES);
  }

  /**
   * A page of Messages, read back from the runtime's record newest first. A Run's Message holds
   * what the Agent said in it, its calls folded under it; a page ends only at a Message from the
   * person, so a Run is never split across two pages.
   */
  async page(root: Conversation, cursor: string | undefined, size: number): Promise<MessagesPage> {
    const before = cursor === undefined ? undefined : Number(cursor);
    const items: Message[] = [];
    let said: { words: string[]; calls: RunCall[] } = { words: [], calls: [] };
    const answering: { item: number; message: string }[] = [];
    // Each Brief and Review on the page, which shows only once it has ended with something to raise.
    const fromClock: { item: number; data: ClockData }[] = [];
    // Each person's Message on the page, which carries a Notice while its newest Run has failed.
    const fromPerson: number[] = [];
    const results = new Map<string, CallDetails>();
    let next: number | undefined = before === undefined ? undefined : before - 1;
    let last: number | null = null;
    scan: for (;;) {
      const page = await root.entries(
        { order: "descending", ...(next === undefined ? {} : { maxEntryId: next as never }) },
        SCAN_RECORDS,
        undefined,
        context,
      );
      for (const entry of page.items) {
        next = (entry.id as number) - 1;
        if (entry.kind === CLOCK_KIND) {
          const data = entry.data as ClockData;
          fromClock.push({ item: items.length, data });
          items.push(agentMessage(said.words, said.calls.toReversed()));
          said = { words: [], calls: [] };
          last = entry.id as number;
          if (items.length >= size) break scan;
          continue;
        }
        if (entry.kind === MESSAGE_KIND) {
          const data = entry.data as MessageData;
          if (said.words.length > 0 || said.calls.length > 0) {
            answering.push({ item: items.length, message: data.id });
            items.push(agentMessage(said.words, said.calls.toReversed()));
          }
          said = { words: [], calls: [] };
          fromPerson.push(items.length);
          items.push(personMessage(data));
          last = entry.id as number;
          if (items.length >= size) break scan;
          continue;
        }
        for (const message of entry.model ?? []) {
          if (message.role === "toolResult") {
            results.set(
              message.toolCallId,
              (message.details as CallDetails | undefined) ?? {
                // The runtime answered it without running it: a tool the Agent is not offered, or
                // input that did not fit the tool's schema.
                result: !AGENT_TOOLS.has(message.toolName as ToolName)
                  ? "not_offered"
                  : message.isError
                    ? "invalid_input"
                    : "ok",
                effects: [],
              },
            );
          } else if (message.role === "assistant") {
            const words = textOf(message);
            if (words !== "") said.words.unshift(words);
            for (const block of message.content.toReversed()) {
              if (block.type !== "toolCall") continue;
              const details = results.get(block.id);
              said.calls.push({
                tool: block.name,
                result: details?.result ?? "running",
                effects: details?.effects ?? [],
              });
            }
          }
        }
      }
      if (page.items.length < SCAN_RECORDS || next === undefined || next < 1) break;
    }
    // What the Agent said before the first Message kept, which a cleared Conversation can leave.
    if (said.words.length > 0 && last === null) {
      items.push(agentMessage(said.words, said.calls.toReversed()));
    }
    const runs = runsAnswering(this.#host.sql, [
      ...fromPerson.map((item) => items[item]?.id ?? ""),
      ...fromClock.map(({ data }) => data.id),
    ]);
    for (const item of fromPerson) {
      const shown = items[item] as PersonMessage;
      const run = runs.get(shown.id);
      if (run?.ended === "failed") shown.notice = noticeOf(run);
    }
    for (const { item, message } of answering) {
      const run = runs.get(message);
      const shown = items[item] as AgentMessage;
      if (run) {
        if (run.ended === "cut_short") {
          shown.words = [shown.words, CUT_SHORT.message]
            .filter((words) => words !== "")
            .join("\n\n");
        }
        shown.id = run.id;
        shown.run = {
          ...shown.run,
          id: run.id,
          ended: run.ended,
          cost: run.ended ? run.cost : null,
        };
      }
    }
    const hidden = new Set<number>();
    for (const { item, data } of fromClock) {
      const run = runs.get(data.id);
      const shown = items[item] as AgentMessage;
      const clock = run ? this.#clockShown(run, data.kind, shown) : null;
      if (clock === null) hidden.add(item);
      else shown.clock = clock;
    }
    const more = last !== null && items.length >= size && last > 1;
    return {
      items: items.filter((_, item) => !hidden.has(item)),
      next_cursor: more ? String(last) : null,
      agent: "available",
    };
  }

  /**
   * A Brief or Review as the Conversation shows it, named by its Run, or null while it is not
   * shown: while it is going, when it had nothing to raise or failed, and once a newer one of its
   * kind replaced it unread.
   */
  #clockShown(run: RunRow, kind: ClockKind, shown: AgentMessage): ClockFold | null {
    if (run.ended === null || run.raised !== 1 || run.replaced === 1) return null;
    const { shown: said } = clockAnswer(shown.words);
    // A Review that answers as a Brief with nothing to raise still says so in one line.
    const words = said === NOTHING_TO_RAISE ? NOTHING_STALE : said;
    shown.words =
      run.ended === "cut_short"
        ? [words, CUT_SHORT[kind]].filter((each) => each !== "").join("\n\n")
        : words;
    shown.id = run.id;
    shown.run = { ...shown.run, id: run.id, ended: run.ended, cost: run.cost };
    const named = JSON.parse(run.tasks_named ?? "[]") as string[];
    return {
      kind,
      taken: instantToIso(run.at),
      read: run.read_at !== null,
      finished_since: finishedSince(this.#host.sql, named, run.at),
    };
  }
}

/**
 * How many rounds of the model a Run takes at most (section 5.2): 25 when the person started it,
 * 10 when the clock did. In code, not a setting. The runtime ends a Run that reaches it.
 */
export const RUN_ROUNDS = { message: 25, clock: 10 } as const;

/** How the runtime says a Run reached the limit of model rounds, which it calls turns. */
const ROUNDS_REACHED = "turn_limit";

/**
 * What a Run cut short at the limit says at the end of its Message, in Praxis's words rather than
 * the model's, since the model was not asked again.
 */
const CUT_SHORT: Record<RunStart, string> = {
  message: `I stopped here: a Run takes at most ${RUN_ROUNDS.message} rounds of the model, and this one reached the limit before I had finished. Tell me to carry on if you want me to.`,
  brief: `I stopped here: a Brief takes at most ${RUN_ROUNDS.clock} rounds of the model, and this one reached the limit before I had finished.`,
  review: `I stopped here: a Review takes at most ${RUN_ROUNDS.clock} rounds of the model, and this one reached the limit before I had finished.`,
};

/** The tools the Agent is offered. */
const AGENT_TOOLS = new Set<ToolName>(offeredTo("agent"));

/** The tools a Brief or a Review is offered: reads only. */
const CLOCK_TOOLS = new Set<ToolName>(offeredTo("clock"));

/** How many Messages a page of the Conversation holds, about. */
const PAGE_MESSAGES = 50;
/** How far back a Run's Message is looked for once it ends, past Messages sent since. */
const RECENT_MESSAGES = 12;
/** How many of the runtime's records are read at a time to make a page. */
const SCAN_RECORDS = 200;

/** The most the model may write of a compaction summary. */
const SUMMARY_TOKENS = 8_192;

const NOTHING_SPENT: RunSpend = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

function personMessage(data: MessageData): PersonMessage {
  return {
    id: data.id,
    from: "person",
    words: data.words,
    at: instantToIso(data.at),
    spoken: data.spoken,
    notice: null,
  };
}

/** The Notice under a person's Message whose newest Run failed. */
function noticeOf(run: RunRow): { run: string; failure: RunFailure } {
  return { run: run.id, failure: run.failure ?? "model_unavailable" };
}

/**
 * Whether a Run reached the model: one of its answers came back, an answer that is not the
 * provider's error. Such a call succeeding ends a refused key's standing Notice.
 */
function reachedModel(records: EntryRecord[]): boolean {
  return records.some((record) =>
    (record.model ?? []).some(
      (message) =>
        message.role === "assistant" &&
        message.stopReason !== "error" &&
        message.stopReason !== "aborted",
    ),
  );
}

function agentMessage(words: string[], calls: RunCall[]): AgentMessage {
  // Named by its Run once the Run record is found; until then by nothing that lasts.
  const id = crypto.randomUUID();
  return {
    id,
    from: "agent",
    words: words.join("\n\n"),
    run: { id, calls, ended: null, cost: null },
    clock: null,
  };
}

/** What the Agent said in a Run's records, every round's words in order, as its Message holds them. */
function saidIn(records: EntryRecord[]): string {
  return records
    .flatMap((record) => record.model ?? [])
    .flatMap((message) => (message.role === "assistant" ? [textOf(message)] : []))
    .filter((words) => words !== "")
    .join("\n\n");
}

/** The text an answer holds, without its tool calls or its thinking. */
function textOf(message: Pick<AssistantMessage, "content">): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

/**
 * The Conversation's messages with each Message's bearings taken out, as the compaction summary is
 * written from them: what the bearings name is given afresh with each Message, and the summary would only
 * restate it.
 */
function withoutBearings(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const content =
      typeof message.content === "string"
        ? personsWords(message.content)
        : message.content.map((block) =>
            block.type === "text" ? { ...block, text: personsWords(block.text) } : block,
          );
    return { ...message, content };
  });
}

/** The runtime's records of one Run: from the Message it answers to the next Message. */
async function runRecords(root: Conversation, first: number): Promise<EntryRecord[]> {
  const found: EntryRecord[] = [];
  let min = first;
  for (;;) {
    const page = await root.entries(
      { order: "ascending", minEntryId: min as never },
      SCAN_RECORDS,
      undefined,
      context,
    );
    for (const entry of page.items) {
      if (entry.kind === MESSAGE_KIND && (entry.id as number) !== first) return found;
      found.push(entry);
      min = (entry.id as number) + 1;
    }
    if (page.items.length < SCAN_RECORDS) return found;
  }
}

/** What the model's answers among these messages spent: their tokens, priced. */
function spendOf(model: string, messages: readonly ModelMessage[]): RunSpend {
  const spend = { ...NOTHING_SPENT };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    spend.input += message.usage.input;
    spend.output += message.usage.output;
    spend.cacheRead += message.usage.cacheRead;
    spend.cacheWrite += message.usage.cacheWrite;
  }
  spend.cost = costOf(model, spend);
  return spend;
}
