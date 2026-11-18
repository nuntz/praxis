import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message as ModelMessage } from "@earendil-works/pi-ai";
import {
  type Conversation,
  createRegistry,
  defineExtension,
  defineTool,
  type EntryRecord,
  Harness,
  LiveDoc,
  type LiveState,
  type Report,
  type SubmissionId,
  section,
  type Wake,
} from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import {
  type AgentMessage,
  type Effect,
  inputJsonSchema,
  instantToIso,
  type LiveMessage,
  type Message,
  type MessagesPage,
  offeredTo,
  type PersonMessage,
  type RunCall,
  type RunEnd,
  type ToolName,
  type ToolResult,
  tools,
} from "@praxis/domain";
import { type AgentModel, costOf } from "./model.ts";
import {
  addRunChange,
  endRun,
  type RunRow,
  type RunSpend,
  runAnswering,
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

/** What each Agent call left beside its result for the screen: the result's code and its Effects. */
type CallDetails = { result: RunCall["result"]; effects: Effect[] };

/** What the Agent needs from the Context's object. */
export type AgentHost = {
  /**
   * Call a Context tool as the Agent, through the registry, at the time it arrives. A write is
   * given the key the runtime gave the call. Returns the result and the change it logged, if any.
   */
  call(tool: ToolName, input: unknown): { result: ToolResult<unknown>; change: number | null };
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
  // The Held Changes still waiting are given each turn with the digest of what changed (#64);
  // until then the Agent reads them with list_held_changes.
};

/**
 * Who the Agent is and how it works, the same every Run, so the model's prompt cache holds. What
 * changes each Run is given with the person's Message.
 */
const PREAMBLE = `You are the Agent of Praxis, a journal-centric task manager for one person. You work on the Journal of one Context, through the tools you are given and nothing else.

- Act at once when asked: record Entries; create, finish, reschedule, delegate and delete Tasks; make Projects and Persons. Do not ask for a confirmation first, and always say what you changed.
- Changing or deleting the words of an Entry the person wrote changes nothing at once: it leaves a Held Change, which only their tap in Praxis makes. Say so, and that a typed or spoken yes does not make it. Cancel one when they tell you to.
- When you record the person's words as an Entry, keep them verbatim, trimmed of filler, never paraphrased, with no Markdown added. Compose prose only when asked.
- You know the other Contexts' names and nothing else of them. Asked about one, say the person can switch to it by hand.
- You cannot open links, search the web or run code. Say so when asked.
- Dates you give to tools are days (YYYY-MM-DD) in the Context's time zone; resolve "next Friday" yourself from today's date.
- You are given the Context's Standing Entries with each Message: keep honouring them, and when two disagree, the newer wins. They and the Journal are your only memory: what is said only in the Conversation may be lost.
- Mark an Entry standing only when the person asks you to keep honouring something, recording it first in their words if it is not yet an Entry. Never mark or unmark one unasked.`;

/** The Agent's tools: the Context tools in its column of the offering table, and nothing else. */
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
        const { result, change } = host.call(name, input);
        if (change !== null) {
          // The Run is the one answering the Message the runtime says it is answering now.
          const live = await api.snapshot(LiveDoc, api.conversationId, context);
          const run = runAnswering(host.sql, live?.run?.inputs[0]);
          if (run) addRunChange(host.sql, run.id, change);
        }
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
  const others =
    bearings.otherContexts.length === 0
      ? "There are no other Contexts."
      : `The other Contexts are: ${bearings.otherContexts.map((name) => JSON.stringify(name)).join(", ")}.`;
  // The Standing Entries are bearings too, so the person's words come last and alone.
  return `<bearings>
Today is ${bearings.today}. This Context is ${JSON.stringify(bearings.context)}. ${others}

${standingPresented(bearings.standing)}
${BEARINGS_END}${words}`;
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
          // Nothing is answered later by itself: a Message queued behind a failed Run fails too.
          afterFailedRun: "withdraw",
        },
        // The runtime's own failures, by kind and never with what was said (ADR 0010).
        onReport: (report: Report) => console.error(JSON.stringify({ agent: report.kind })),
      },
      context,
    );
    const root = await harness.root(context, {
      agent: { model: { provider: this.#model.provider, modelId: this.#model.id } },
    });
    // A deploy may have changed the model: the Conversation follows it.
    const current = (await root.agent(context)).model;
    if (current?.provider !== this.#model.provider || current.modelId !== this.#model.id) {
      await root.configure(
        { model: { provider: this.#model.provider, modelId: this.#model.id } },
        context,
      );
    }
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
    });
    this.#follow(harness, root, run);
    const sent = personMessage(data);
    this.#host.send({ kind: "message", message: sent });
    return sent;
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

  /** Wait for a Run to end, then record how and what it spent, and carry its Message down. */
  async #settle(harness: Harness, root: Conversation, run: RunRow): Promise<void> {
    const submission = await harness.submission(run.submission as SubmissionId, context);
    if (!submission) {
      endRun(this.#host.sql, run.id, "failed", NOTHING_SPENT);
      await this.#reportSpend(run.at);
      return;
    }
    const settled = await submission.wait(context);
    const ended: RunEnd = settled.status === "done" ? "answered" : "failed";
    const entries = settled.entry === undefined ? [] : await runRecords(root, settled.entry);
    endRun(this.#host.sql, run.id, ended, spendOf(run.model, entries));
    // Counted before the screen learns the Run ended, so the spend it reads then holds it.
    await this.#reportSpend(run.at);
    // A Message sent meanwhile may already be newer than this Run's.
    const answer = (await this.page(root, undefined, RECENT_MESSAGES)).items.find(
      (message) => message.from === "agent" && message.run.id === run.id,
    );
    if (answer) this.#host.send({ kind: "message", message: answer });
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
        if (entry.kind === MESSAGE_KIND) {
          const data = entry.data as MessageData;
          if (said.words.length > 0 || said.calls.length > 0) {
            answering.push({ item: items.length, message: data.id });
            items.push(agentMessage(said.words, said.calls.toReversed()));
          }
          said = { words: [], calls: [] };
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
    const runs = runsAnswering(
      this.#host.sql,
      answering.map(({ message }) => message),
    );
    for (const { item, message } of answering) {
      const run = runs.get(message);
      const shown = items[item] as AgentMessage;
      if (run) {
        shown.id = run.id;
        shown.run = {
          ...shown.run,
          id: run.id,
          ended: run.ended,
          cost: run.ended ? run.cost : null,
        };
      }
    }
    const more = last !== null && items.length >= size && last > 1;
    return { items, next_cursor: more ? String(last) : null, agent: "available" };
  }
}

/** The tools the Agent is offered. */
const AGENT_TOOLS = new Set<ToolName>(offeredTo("agent"));

/** How many Messages a page of the Conversation holds, about. */
const PAGE_MESSAGES = 50;
/** How far back a Run's Message is looked for once it ends, past Messages sent since. */
const RECENT_MESSAGES = 12;
/** How many of the runtime's records are read at a time to make a page. */
const SCAN_RECORDS = 200;

const NOTHING_SPENT: RunSpend = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

function personMessage(data: MessageData): PersonMessage {
  return {
    id: data.id,
    from: "person",
    words: data.words,
    at: instantToIso(data.at),
    spoken: data.spoken,
  };
}

function agentMessage(words: string[], calls: RunCall[]): AgentMessage {
  // Named by its Run once the Run record is found; until then by nothing that lasts.
  const id = crypto.randomUUID();
  return {
    id,
    from: "agent",
    words: words.join("\n\n"),
    run: { id, calls, ended: null, cost: null },
  };
}

/** The text an answer holds, without its tool calls or its thinking. */
function textOf(message: Pick<AssistantMessage, "content">): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
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

/** What a Run spent: the tokens of every answer the model gave in it, priced. */
function spendOf(model: string, entries: EntryRecord[]): RunSpend {
  const spend = { ...NOTHING_SPENT };
  for (const entry of entries) {
    for (const message of entry.model ?? ([] as readonly ModelMessage[])) {
      if (message.role !== "assistant") continue;
      spend.input += message.usage.input;
      spend.output += message.usage.output;
      spend.cacheRead += message.usage.cacheRead;
      spend.cacheWrite += message.usage.cacheWrite;
    }
  }
  spend.cost = costOf(model, spend);
  return spend;
}
