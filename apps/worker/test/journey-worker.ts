import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { contextObject } from "../src/context-object.ts";
import { lastWords, scriptModel, testModel } from "./model-fake.ts";

// The Worker the browser journeys run against (playwright.config.ts): Praxis as deployed, with each
// Context's Agent on a scripted model, so no journey calls a real model. The script stands in for
// a model asked to record something: "Record: <words>" records an Entry of those words, and then
// it answers. Anything else it only answers. Never deployed.

export { DeploymentObject, default } from "../src/index.ts";

const RECORD = /^Record: ([\s\S]+)$/;

scriptModel(
  (context) => {
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("Recorded.");
    const asked = RECORD.exec(lastWords(context).trim());
    if (!asked?.[1]) return fauxAssistantMessage("Noted.");
    return fauxAssistantMessage(fauxToolCall("record_entry", { words: asked[1] }), {
      stopReason: "toolUse",
    });
  },
  { wordsPerSecond: 20 },
);

export const ContextObject = contextObject(testModel);
