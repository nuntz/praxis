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

// The model is one of the four faked things (section 13). The fake is pi-ai's faux provider
// playing a script: fixed tool calls and words, through the real runtime loop in workerd. It runs
// in the isolate the Context objects run in, so a test scripts it before it sends a Message. What
// the Agent says or chooses is never asserted: only what its calls did.

/** What the scripted model does with each request it is sent. */
export type Script = FauxResponseFactory;

let playingModel: AgentModel | NoAgent = "no_key";

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
  const step: Script = (...args) => {
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
