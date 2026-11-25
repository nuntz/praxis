import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, inject, test } from "vitest";
import {
  type AgentModel,
  anthropicModel,
  PRICES,
  runFailure,
  unpricedModel,
} from "../src/model.ts";
import {
  providerError as answer,
  KEY_REFUSED,
  lastWords,
  REQUEST_REFUSED,
  scriptModel,
  testModel,
  UNAVAILABLE,
} from "./model-fake.ts";

// The model's one contract suite (section 13). In CI it runs against the scripted model only, so
// CI never calls a model. By hand it runs against the real one too, with the person's own key:
//
//   AGENT_API_KEY=… [AGENT_MODEL=…] bun run --cwd apps/worker test model
//
// It checks what the Agent's runtime needs of a model: words, tokens counted, and tool calls.

/** A tool the contract offers the model, shaped as a Context tool is. */
const RECORD = {
  name: "record_note",
  description: "Record a note in the person's words.",
  parameters: {
    type: "object",
    properties: { words: { type: "string" } },
    required: ["words"],
    additionalProperties: false,
  },
};

/** Ask the model, or, with `id`, a model of the same provider by that id, known to it or not. */
function ask(model: AgentModel, text: string, tools: (typeof RECORD)[] = [], id?: string) {
  const found = model.models.getModel(model.provider, model.id);
  if (!found) throw new Error(`The model ${model.provider}/${model.id} is not there`);
  return model.models.completeSimple(id === undefined ? found : { ...found, id }, {
    systemPrompt: "You are a terse assistant. Use a tool when asked to.",
    messages: [{ role: "user", content: text, timestamp: 0 }],
    tools,
  });
}

/**
 * The contract, run against one model. `refusedKey` gives what its provider says when it refuses
 * the key: for the real one, what it answers a key that is not one. `refusedRequest` gives what it
 * says when it refuses the request itself: for the real one, what it answers asked for a model it
 * does not know.
 */
function contract(
  name: string,
  model: () => AgentModel,
  refused: { key: () => Promise<string>; request: () => Promise<string> },
) {
  describe(`the model: ${name}`, () => {
    test("it is one the code ships a price for", () => {
      expect(PRICES[model().id]).toBeDefined();
    });

    test("it answers a Message in words, and says how many tokens it took", async () => {
      const answer = await ask(model(), "Say hello in one word.");

      expect(answer.stopReason).toBe("stop");
      expect(answer.content.some((block) => block.type === "text" && block.text.trim())).toBe(true);
      expect(answer.usage.input).toBeGreaterThan(0);
      expect(answer.usage.output).toBeGreaterThan(0);
    });

    test("the provider refusing the key, refusing the request, and being unavailable are told apart", async () => {
      expect(runFailure("model_error", await refused.key())).toBe("key_refused");
      expect(runFailure("model_error", await refused.request())).toBe("request_refused");
      expect(runFailure("model_error", UNAVAILABLE)).toBe("model_unavailable");
    });

    test("offered a tool and asked to use it, it calls it with input the schema takes", async () => {
      const answer = await ask(model(), "Use record_note to record: buy milk.", [RECORD]);

      expect(answer.stopReason).toBe("toolUse");
      const call = answer.content.find((block) => block.type === "toolCall");
      expect(call).toMatchObject({ name: "record_note", arguments: { words: expect.any(String) } });
    });
  });
}

contract(
  "scripted",
  () => {
    // Scripted to do what the contract asks, as a model would.
    scriptModel((context) =>
      lastWords(context).includes("record_note")
        ? fauxAssistantMessage(fauxToolCall("record_note", { words: "buy milk" }), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("Hello."),
    );
    const scripted = testModel();
    if (typeof scripted === "string") throw new Error("No scripted model");
    return scripted;
  },
  { key: async () => KEY_REFUSED, request: async () => REQUEST_REFUSED },
);

const real = inject("realModel");
if (real) {
  const configured = (key: string) => {
    const found = anthropicModel({ AGENT_API_KEY: key, AGENT_MODEL: real.model });
    if (typeof found === "string") throw new Error(`No model to run against: ${found}`);
    return found;
  };
  contract("real", () => configured(real.key), {
    key: async () => (await ask(configured("sk-ant-not-a-key"), "Hello.")).errorMessage ?? "",
    request: async () =>
      (await ask(configured(real.key), "Hello.", [], "claude-not-a-model")).errorMessage ?? "",
  });
}

describe("why a Run failed, from the provider's answer", () => {
  test.each([
    [answer(400, "invalid_request_error", "Tool reference 'x' not found in available tools.")],
    [answer(404, "not_found_error", "model: claude-not-a-model")],
    [answer(413, "request_too_large", "Request exceeds the maximum allowed number of bytes.")],
  ])("a request the provider refuses is refused, which no wait mends: %s", (said) => {
    expect(runFailure("model_error", said)).toBe("request_refused");
  });

  test.each([
    [answer(401, "authentication_error", "invalid x-api-key")],
    [answer(403, "permission_error", "Your API key does not have permission to use this model.")],
    [
      answer(
        400,
        "invalid_request_error",
        "Your credit balance is too low to access the Anthropic API.",
      ),
    ],
  ])("the key the provider refuses is refused, even as a 400: %s", (said) => {
    expect(runFailure("model_error", said)).toBe("key_refused");
  });

  test.each([
    [answer(408, "timeout_error", "Request timed out.")],
    [answer(429, "rate_limit_error", "Number of request tokens has exceeded your rate limit.")],
    [answer(500, "api_error", "Internal server error")],
    [answer(529, "overloaded_error", "Overloaded")],
    [answer(null, "overloaded_error", "Overloaded")],
    ["fetch failed"],
  ])("the model not reached, which waiting mends, is unavailable: %s", (said) => {
    expect(runFailure("model_error", said)).toBe("model_unavailable");
  });
});

describe("the deploy's check of the configured model", () => {
  test("a model the code ships no price for fails it, naming the model and the ones priced", () => {
    expect(unpricedModel({ AGENT_MODEL: "claude-haiku-4-5" })).toBe(
      'The configured model "claude-haiku-4-5" has no price shipped with Praxis, so its Runs could not be counted against the spend cap. Name one of: claude-sonnet-5-5.',
    );
  });

  test("the default, or a model priced, passes it", () => {
    expect(unpricedModel({})).toBeNull();
    expect(unpricedModel({ AGENT_MODEL: " claude-sonnet-5-5 " })).toBeNull();
  });
});
