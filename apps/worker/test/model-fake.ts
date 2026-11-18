import {
  createModels,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { NoAgent } from "@praxis/domain";
import { personsWords } from "../src/agent.ts";
import { type AgentModel, DEFAULT_MODEL, PRICES } from "../src/model.ts";

// The model is one of the four faked things (section 13). The fake is pi-ai's faux provider
// playing a script: fixed tool calls and words, through the real runtime loop in workerd. It runs
// in the isolate the Context objects run in, so a test scripts it before it sends a Message. What
// the Agent says or chooses is never asserted: only what its calls did.

/** What the scripted model does with each request it is sent. */
export type Script = FauxResponseFactory;

let playing: AgentModel | NoAgent = "no_key";

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
export function scriptModel(script: Script, { wordsPerSecond }: { wordsPerSecond?: number } = {}) {
  const faux = fauxProvider({
    provider: "scripted",
    models: [{ id: DEFAULT_MODEL, cost: SCRIPTED_PRICE, contextWindow: 200_000 }],
    // Streamed a few characters at a time, as a model writes, when a pace is given.
    ...(wordsPerSecond === undefined
      ? {}
      : { tokensPerSecond: wordsPerSecond, tokenSize: { min: 1, max: 1 } }),
  });
  const models = createModels();
  models.setProvider(faux.provider);
  // Each request takes the next response; one script for every request it might make.
  faux.setResponses(Array.from({ length: 500 }, () => script));
  playing = { models, provider: "scripted", id: DEFAULT_MODEL };
  return faux;
}

/** No model: a Deployment whose configuration gives no key, which has no Agent. */
export function noModel(why: NoAgent = "no_key"): void {
  playing = why;
}

/** The model the Context objects of the tests run their Agent on, or why there is none. */
export function testModel(): AgentModel | NoAgent {
  return playing;
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
