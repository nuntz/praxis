import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { NOTHING_TO_RAISE } from "../src/agent.ts";
import { contextObject } from "../src/context-object.ts";
import { meanAlike, testMeaning } from "./meaning-fake.ts";
import {
  lastWords,
  SCRIPTED_RETRY,
  scriptModel,
  testModel,
  textOf,
  UNAVAILABLE,
} from "./model-fake.ts";
import { testVoice } from "./voice-fake.ts";

// The Worker the browser journeys run against (playwright.config.ts): Praxis as deployed, with each
// Context's Agent on a scripted model, so no journey calls a real model. The script stands in for
// a model asked to record something: "Record: <words>" records an Entry of those words, and
// "Edit <id> at <version>: <words>" changes that Entry's words, and then it answers. "Say:
// <words>" answers with those words, as a model writing Markdown would. "Unreachable
// once: <words>" fails as an overloaded provider does for the whole of the first Run that asks,
// then answers when the Run is tried again. A Brief or a Review has nothing to raise, so one the
// clock starts while a journey runs leaves no Message, except in a Context whose name begins
// "Briefed", where it raises something, for a journey to see it unread. Anything else it only answers. Its meaning index is the
// fake, which takes a molar and a dentist to mean alike. Its voice provider is the fake's end at the
// object, which sets up every Call it is asked for; the Device's end is faked in the browser
// (e2e/voice-fake.ts), with scripted text and no sound. Never deployed.

export { DeploymentObject, default } from "../src/index.ts";

const RECORD = /^Record: ([\s\S]+)$/;
const SAY = /^Say: ([\s\S]+)$/;
const EDIT = /^Edit (\S+) at (\d+): ([\s\S]+)$/;
const UNREACHABLE_ONCE = /^Unreachable once: /;
const CLOCK_STARTED = /^The clock started this Run/;
const BRIEFED = /This Context is "Briefed /;

/** How often each Message the model is to fail once has been asked, by its words. */
const asks = new Map<string, number>();

scriptModel((context) => {
  if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("Recorded.");
  const words = lastWords(context).trim();
  if (CLOCK_STARTED.test(words)) {
    const told = textOf(context.messages.findLast((message) => message.role === "user"));
    if (!BRIEFED.test(told)) return fauxAssistantMessage(NOTHING_TO_RAISE);
    return fauxAssistantMessage("Nothing is due today.\n<tasks_named></tasks_named>");
  }
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
  const said = SAY.exec(words);
  if (said?.[1]) return fauxAssistantMessage(said[1]);
  const asked = RECORD.exec(words);
  if (!asked?.[1]) return fauxAssistantMessage("Noted.");
  return fauxAssistantMessage(fauxToolCall("record_entry", { words: asked[1] }), {
    stopReason: "toolUse",
  });
});

meanAlike("dentist", "molar");

export const ContextObject = contextObject(testModel, testMeaning, testVoice);
