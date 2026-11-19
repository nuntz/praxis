import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentMessage, MessagesPage, PersonMessage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { lastWords, scriptModel, textOf } from "./model-fake.ts";
import { hand, newContext, value } from "./seam.ts";

// A Run cannot run away (section 5.2): it is limited to 25 model rounds when the person started
// it, in code. One that reaches the limit stops, says so in its last Message, and its record marks
// it as cut short. The clock's limit of 10 is for the Brief and the Review (#67).

describe("send_message: a Run that reaches the limit of model rounds", () => {
  test("stops after 25, says so in its Message, and is marked cut short, not failed", async () => {
    let asked = 0;
    // A model that never stops calling a tool.
    scriptModel(() => {
      asked += 1;
      return fauxAssistantMessage(fauxToolCall("get_settings", {}), { stopReason: "toolUse" });
    });
    const context = newContext();

    value(await context.callAny(hand, "send_message", { words: marked("Keep going") }));
    await context.runsEnded();

    expect(asked).toBe(25);
    const [answer, sent] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
      .items as [AgentMessage, PersonMessage];
    expect(answer.run.ended).toBe("cut_short");
    expect(answer.run.calls).toHaveLength(25);
    expect(answer.words).toMatch(/25 rounds/);
    // Not a failure: no Notice, and nothing to try again.
    expect(sent.notice).toBeNull();
    const again = await context.callAny(hand, "retry_run", { run: answer.run.id });
    expect(again.ok).toBe(false);
  });

  test("the next Message is answered as usual", async () => {
    const thanks = marked("Thanks");
    scriptModel((request) =>
      lastWords(request) === thanks
        ? fauxAssistantMessage("You're welcome.")
        : fauxAssistantMessage(fauxToolCall("get_settings", {}), { stopReason: "toolUse" }),
    );
    const context = newContext();

    value(await context.callAny(hand, "send_message", { words: marked("Keep going") }));
    await context.runsEnded();
    value(await context.callAny(hand, "send_message", { words: thanks }));
    await context.runsEnded();

    const [answer] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
      .items as [AgentMessage];
    expect(answer).toMatchObject({ words: "You're welcome.", run: { ended: "answered" } });
  });

  test("the next Message tells the Agent its last Run was cut short, so it can carry on", async () => {
    const told: string[] = [];
    const carryOn = marked("Carry on");
    scriptModel((request) => {
      const last = request.messages.findLast((message) => message.role === "user");
      if (lastWords(request) === carryOn) {
        told.push(textOf(last));
        return fauxAssistantMessage("Carrying on.");
      }
      return fauxAssistantMessage(fauxToolCall("get_settings", {}), { stopReason: "toolUse" });
    });
    const context = newContext();

    value(await context.callAny(hand, "send_message", { words: marked("Keep going") }));
    await context.runsEnded();
    value(await context.callAny(hand, "send_message", { words: carryOn }));
    await context.runsEnded();
    value(await context.callAny(hand, "send_message", { words: carryOn }));
    await context.runsEnded();

    expect(told).toHaveLength(2);
    expect(told[0]).toMatch(/last Run was cut short/);
    expect(told[1]).not.toMatch(/cut short/);
  });
});
