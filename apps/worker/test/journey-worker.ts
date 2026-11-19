import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { contextObject } from "../src/context-object.ts";
import { lastWords, SCRIPTED_RETRY, scriptModel, testModel, UNAVAILABLE } from "./model-fake.ts";

// The Worker the browser journeys run against (playwright.config.ts): Praxis as deployed, with each
// Context's Agent on a scripted model, so no journey calls a real model. The script stands in for
// a model asked to record something: "Record: <words>" records an Entry of those words, and
// "Edit <id> at <version>: <words>" changes that Entry's words, and then it answers. "Unreachable
// once: <words>" fails as an overloaded provider does for the whole of the first Run that asks,
// then answers when the Run is tried again. Anything else it only answers. Never deployed.

export { DeploymentObject, default } from "../src/index.ts";

const RECORD = /^Record: ([\s\S]+)$/;
const EDIT = /^Edit (\S+) at (\d+): ([\s\S]+)$/;
const UNREACHABLE_ONCE = /^Unreachable once: /;

/** How often each Message the model is to fail once has been asked, by its words. */
const asks = new Map<string, number>();

scriptModel(
  (context) => {
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("Recorded.");
    const words = lastWords(context).trim();
    if (UNREACHABLE_ONCE.test(words)) {
      const times = (asks.get(words) ?? 0) + 1;
      asks.set(words, times);
      // The first Run asks once and again as often as its retries allow; each one fails.
      if (times <= 1 + SCRIPTED_RETRY.maxRetries) {
        return fauxAssistantMessage([], { stopReason: "error", errorMessage: UNAVAILABLE });
      }
      return fauxAssistantMessage("Back again.");
    }
    const edit = EDIT.exec(words);
    if (edit?.[1] && edit[2] && edit[3]) {
      const input = { id: edit[1], version: Number(edit[2]), words: edit[3] };
      return fauxAssistantMessage(fauxToolCall("edit_entry", input), { stopReason: "toolUse" });
    }
    const asked = RECORD.exec(words);
    if (!asked?.[1]) return fauxAssistantMessage("Noted.");
    return fauxAssistantMessage(fauxToolCall("record_entry", { words: asked[1] }), {
      stopReason: "toolUse",
    });
  },
  { wordsPerSecond: 20 },
);

export const ContextObject = contextObject(testModel);
