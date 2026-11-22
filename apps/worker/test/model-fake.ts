import {
  createModels,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { CompactionPolicy, JsonObject } from "@earendil-works/pi-durable";
import type { NoAgent } from "@praxis/domain";
import { personsWords } from "../src/agent.ts";
import { type AgentModel, DEFAULT_MODEL, PRICES, type RunRetry } from "../src/model.ts";

// The model is one of the faked things (section 13). The fake is pi-ai's faux provider
// playing a script: fixed tool calls and words, through the real runtime loop in workerd. It runs
// in the isolate the Context objects run in, so a test scripts it before it sends a Message. What
// the Agent says or chooses is never asserted: only what its calls did.

/** What the scripted model does with each request it is sent. */
export type Script = FauxResponseFactory;

let playingModel: AgentModel | NoAgent = "no_key";

/** The script playing now: one asked after another replaced it is asked by a Context it missed. */
let playing: object = {};

/** What each script asked after a newer one replaced it was asked by, in this test. */
const superseded: string[] = [];

/**
 * The scripts asked in this test after a newer one replaced them. A Context keeps the model it
 * was first asked with, so a script given once its Agent is open never reaches it: the test then
 * runs on the script it meant to replace.
 */
export function supersededScripts(): readonly string[] {
  return superseded;
}

/** Start a test with no script asked out of turn. */
export function forgetSuperseded(): void {
  superseded.length = 0;
}

/**
 * The scripted model is asked again as the real one is, but at once: twice more, a millisecond
 * apart, so a test sees the asking again without waiting seconds for it.
 */
export const SCRIPTED_RETRY: RunRetry = { maxRetries: 2, baseDelayMs: 1, maxAgentDelayMs: 1 };

/** The scripted model is priced as the model it stands in for. */
const SCRIPTED_PRICE = PRICES[DEFAULT_MODEL] ?? {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/**
 * Put the Agents of Contexts used from now on on a scripted model playing `script`, standing in
 * for the model the Deployment ships a price for. A Context keeps the model it was first asked
 * with, so script the model before the first Message.
 */
export function scriptModel(
  script: Script,
  {
    wordsPerSecond,
    contextWindow = 200_000,
    compaction,
  }: {
    wordsPerSecond?: number;
    contextWindow?: number;
    compaction?: Partial<CompactionPolicy>;
  } = {},
) {
  const faux = fauxProvider({
    provider: "scripted",
    models: [{ id: DEFAULT_MODEL, cost: SCRIPTED_PRICE, contextWindow }],
    // Streamed a few characters at a time, as a model writes, when a pace is given.
    ...(wordsPerSecond === undefined
      ? {}
      : { tokensPerSecond: wordsPerSecond, tokenSize: { min: 1, max: 1 } }),
  });
  const models = createModels();
  models.setProvider(faux.provider);
  // Each request takes the next response, and each puts the script back for the one after, so
  // it never runs out: a provider with no response left fails the request, as a model error.
  const mine = {};
  playing = mine;
  const step: Script = (...args) => {
    if (playing !== mine) superseded.push(lastWords(args[0]));
    faux.appendResponses([step]);
    return script(...args);
  };
  faux.setResponses([step]);
  playingModel = {
    models,
    provider: "scripted",
    id: DEFAULT_MODEL,
    retry: SCRIPTED_RETRY,
    ...(compaction === undefined ? {} : { compaction }),
  };
  return faux;
}

/** No model: a Deployment whose configuration gives no key, which has no Agent. */
export function noModel(why: NoAgent = "no_key"): void {
  playingModel = why;
}

/** The model the Context objects of the tests run their Agent on, or why there is none. */
export function testModel(): AgentModel | NoAgent {
  return playingModel;
}

type ModelMessage = TranscriptContext["messages"][number];

/** The text of a message, of whatever role. */
export function textOf(message: ModelMessage | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  return (content ?? []).map((block) => ("text" in block ? block.text : "")).join("");
}

/** The person's words in the newest Message the model was sent, without the Run's bearings. */
export function lastWords(context: TranscriptContext): string {
  const last = context.messages.findLast((message) => message.role === "user");
  return personsWords(textOf(last));
}

/** What a request offered the model and told it of itself: the tools it may call, and its preamble. */
export type Offered = { tools: Set<string>; preamble: string };

/**
 * What a request offered the model: the runtime puts both on its system messages, the tools as
 * `toolsAdded` and the prompt's sections under `sections`, never in `context.tools`.
 */
export function offeredIn(context: TranscriptContext): Offered {
  const system = context.messages.filter((message) => message.role === "system");
  return {
    tools: new Set(system.flatMap((message) => (message.toolsAdded ?? []).map(({ name }) => name))),
    preamble: system.map((message) => Object.values(message.sections ?? {}).join("\n")).join(""),
  };
}

/**
 * The tools a request's system messages remove or add again while they are not offered, replayed in
 * order: the provider refuses a request naming any (`tool_reference_unresolved`), so a request
 * the real model would refuse names some.
 */
export function unresolvedTools(context: TranscriptContext): string[] {
  const offered = new Set<string>();
  const unresolved: string[] = [];
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    for (const { name } of message.toolsRemoved ?? []) {
      if (!offered.delete(name)) unresolved.push(name);
    }
    for (const { name } of message.toolsAdded ?? []) offered.add(name);
  }
  return unresolved;
}

/** The tool results the model has been given since the newest Message. */
function resultsSinceMessage(context: TranscriptContext): ModelMessage[] {
  const from = context.messages.findLastIndex((message) => message.role === "user");
  return context.messages.slice(from + 1).filter((message) => message.role === "toolResult");
}

/**
 * A script that answers each Message by making `calls` one after the other, each given what the
 * results so far said, then answers in words. A call is a tool's name and its input.
 */
export function calling(
  calls: ((results: string[]) => [string, JsonObject] | null)[],
  answer = "Done.",
): Script {
  return (context) => {
    const results = resultsSinceMessage(context).map(textOf);
    const next = calls[results.length]?.(results);
    if (!next) return fauxAssistantMessage(answer);
    return fauxAssistantMessage(fauxToolCall(...next), { stopReason: "toolUse" });
  };
}

/**
 * A script that answers in these words only once `answer()` is called, so a test holds a Run going
 * while it calls something else.
 */
export function heldAnswer(words = "Done."): { script: Script; answer: () => void } {
  let answer = () => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const done = answering(words);
  return {
    script: async (...args) => {
      await answered;
      return done(...args);
    },
    answer,
  };
}

/** A script that answers every Message in these words, calling nothing. */
export function answering(words: string): Script {
  return () => fauxAssistantMessage(words);
}

/**
 * What Anthropic answers when it cannot answer for now: overloaded. Only waiting mends it, so a
 * Run asks again.
 */
export const UNAVAILABLE =
  '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';

/** What Anthropic answers when the key is wrong. Asking again would not mend it. */
export const KEY_REFUSED =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';

/** A script whose every answer is the provider's error, in these words. */
export function failing(error: string): Script {
  return () => fauxAssistantMessage([], { stopReason: "error", errorMessage: error });
}
