import type { MessagesPage, PersonMessage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import {
  answering,
  failing,
  KEY_REFUSED,
  lastWords,
  SCRIPTED_RETRY,
  type Script,
  scriptModel,
  UNAVAILABLE,
} from "./model-fake.ts";
import { hand, newContext, newDeployment, value } from "./seam.ts";

// When the model cannot be reached (section 5.6, ADR 0017): a Run the person started asks again
// for seconds, then ends as failed. The person's Message stays, with a Notice under it that is
// not a Message and a way to try again, and nothing answers it later by itself. The provider
// refusing the key is told apart: it is a standing Notice too, until a call succeeds.

type Context = ReturnType<typeof newContext>;
type Deployment = ReturnType<typeof newDeployment>;

/** A Context made by the hand in this Deployment, reached as the Worker reaches one. */
async function makeContext(deployment: Deployment, name = "Work") {
  const made = await deployment.call(hand, "create_context", {
    name,
    time_zone: "UTC",
    accent: "blue",
  });
  return deployment.context(value(made).record.id);
}

async function messages(context: Pick<Context, "callAny">): Promise<MessagesPage["items"]> {
  return (value(await context.callAny(hand, "list_messages", {})) as MessagesPage).items;
}

/** Send the person's Message and wait for every Run to end. */
async function sendAndSettle(context: Pick<Context, "callAny" | "runsEnded">, words: string) {
  const sent = value(await context.callAny(hand, "send_message", { words })) as {
    message: PersonMessage;
  };
  await context.runsEnded();
  return sent.message;
}

/** A script that fails with `error` while `down()` is true, and answers once it is not. */
function failingWhile(down: () => boolean, error: string): Script {
  const failed = failing(error);
  const answered = answering("Back again.");
  return (...args) => (down() ? failed(...args) : answered(...args));
}

describe("send_message when the model cannot be reached", () => {
  test("the Run asks again, then fails: the Message stays with a Notice under it, and no answer", async () => {
    const faux = scriptModel(failing(UNAVAILABLE));
    const context = newContext();

    const sent = await sendAndSettle(context, marked("Are you there?"));

    expect(faux.state.callCount).toBe(1 + SCRIPTED_RETRY.maxRetries);
    expect(await messages(context)).toEqual([
      { ...sent, notice: { run: expect.any(String), failure: "model_unavailable" } },
    ]);
  });

  test("nothing answers the Message later by itself", async () => {
    let down = true;
    const faux = scriptModel(failingWhile(() => down, UNAVAILABLE));
    const context = newContext();
    await sendAndSettle(context, marked("Are you there?"));
    const asked = faux.state.callCount;

    down = false;
    await context.runScheduledAlarm();
    await context.runsEnded();

    expect(faux.state.callCount).toBe(asked);
    expect((await messages(context)).map((message) => message.from)).toEqual(["person"]);
  });

  test("shows only on the Run that failed: it is no standing Notice", async () => {
    scriptModel(failing(UNAVAILABLE));
    const context = newContext();

    await sendAndSettle(context, marked("Are you there?"));

    expect(value(await context.call(hand, "list_notices", {})).items).toEqual([]);
  });

  test("a Message sent while the Run was going stays too, each with its own Notice", async () => {
    scriptModel(failing(UNAVAILABLE));
    const context = newContext();

    await context.callAny(hand, "send_message", { words: marked("First") });
    await sendAndSettle(context, marked("Second"));

    const shown = await messages(context);
    expect(shown.map((message) => message.from)).toEqual(["person", "person"]);
    expect(shown).toMatchObject([
      { notice: { failure: "model_unavailable" } },
      { notice: { failure: "model_unavailable" } },
    ]);
  });
});

describe("send_message when the provider refuses the key", () => {
  test("the Run fails at once, its Notice saying the key was refused", async () => {
    const faux = scriptModel(failing(KEY_REFUSED));
    const context = newContext();

    await sendAndSettle(context, marked("Hello"));

    expect(faux.state.callCount).toBe(1);
    expect(await messages(context)).toMatchObject([
      { from: "person", notice: { failure: "key_refused" } },
    ]);
  });

  test("is a standing Notice, in every Context of the Deployment, until a call succeeds", async () => {
    let refused = true;
    scriptModel(failingWhile(() => refused, KEY_REFUSED));
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");

    await sendAndSettle(work, marked("Hello"));
    const standing = value(await home.call(hand, "list_notices", {})).items;
    refused = false;
    await sendAndSettle(home, marked("Hello again"));

    expect(standing).toEqual([{ kind: "key_refused", since: "2026-11-15T09:00:00.000Z" }]);
    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([]);
  });
});

describe("send_message when the key is taken, reported after a refusal made since", () => {
  test("ends no refusal later than the Run that took it started", async () => {
    let refused = false;
    scriptModel(failingWhile(() => refused, KEY_REFUSED));
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");

    // Reports from two Contexts arrive in any order: a Run that took the key at 09:00 is reported
    // after one refused at 10:00.
    refused = true;
    deployment.advance(60 * 60 * 1000);
    await sendAndSettle(work, marked("Refused at ten"));
    refused = false;
    deployment.advance(-60 * 60 * 1000);
    await sendAndSettle(home, marked("Taken at nine"));
    const standing = value(await work.call(hand, "list_notices", {})).items;
    deployment.advance(2 * 60 * 60 * 1000);
    await sendAndSettle(home, marked("Taken at eleven"));

    expect(standing).toEqual([{ kind: "key_refused", since: "2026-11-15T10:00:00.000Z" }]);
    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([]);
  });
});

describe("retry_run", () => {
  test("tries the failed Run again from the person's Message, which loses its Notice", async () => {
    let down = true;
    scriptModel(failingWhile(() => down, UNAVAILABLE));
    const context = newContext();
    const sent = await sendAndSettle(context, marked("Are you there?"));
    const [failed] = await messages(context);
    if (failed?.from !== "person" || !failed.notice) throw new Error("No Run failed");

    down = false;
    const retried = await context.callAny(hand, "retry_run", { run: failed.notice.run });
    await context.runsEnded();

    expect(value(retried)).toEqual({ message: { ...sent, notice: null } });
    const shown = await messages(context);
    expect(shown).toMatchObject([
      { from: "agent", words: "Back again.", run: { ended: "answered" } },
      { ...sent, notice: null },
    ]);
    expect(shown[0]?.from === "agent" && shown[0].run.id).not.toBe(failed.notice.run);
  });

  test("a Run that fails again leaves the Notice, naming the new Run", async () => {
    scriptModel(failing(UNAVAILABLE));
    const context = newContext();
    await sendAndSettle(context, marked("Are you there?"));
    const [failed] = await messages(context);
    if (failed?.from !== "person" || !failed.notice) throw new Error("No Run failed");

    await context.callAny(hand, "retry_run", { run: failed.notice.run });
    await context.runsEnded();

    const [again] = await messages(context);
    expect(again).toMatchObject({ from: "person", notice: { failure: "model_unavailable" } });
    expect(again?.from === "person" && again.notice?.run).not.toBe(failed.notice.run);
  });

  test("counts what it spent once, apart from what the Run that failed spent", async () => {
    let down = true;
    scriptModel(failingWhile(() => down, UNAVAILABLE));
    const deployment = newDeployment();
    const work = await makeContext(deployment);
    await sendAndSettle(work, marked("Are you there?"));
    const [failed] = await messages(work);
    if (failed?.from !== "person" || !failed.notice) throw new Error("No Run failed");

    const before = value(await deployment.call(hand, "get_spend", {})).spent;

    down = false;
    await work.callAny(hand, "retry_run", { run: failed.notice.run });
    await work.runsEnded();

    const [answer] = await messages(work);
    if (answer?.from !== "agent") throw new Error("No answer");
    expect(answer.run.cost).toBeGreaterThan(0);
    expect(value(await deployment.call(hand, "get_spend", {})).spent).toBeCloseTo(
      before + (answer.run.cost ?? 0),
      10,
    );
  });

  test("only the newest Message's Run: one sent since has moved the Conversation on", async () => {
    scriptModel(failing(UNAVAILABLE));
    const context = newContext();
    await sendAndSettle(context, marked("First"));
    await sendAndSettle(context, marked("Second"));
    const [, first] = await messages(context);
    if (first?.from !== "person" || !first.notice) throw new Error("No Run failed");

    const retried = await context.callAny(hand, "retry_run", { run: first.notice.run });

    expect(retried).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("a Run that answered is not tried again", async () => {
    scriptModel(answering("Here."));
    const context = newContext();
    await sendAndSettle(context, marked("Hello"));
    const [answer] = await messages(context);
    if (answer?.from !== "agent") throw new Error("No answer");

    const retried = await context.callAny(hand, "retry_run", { run: answer.run.id });

    expect(retried).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("a Run there never was is not found", async () => {
    const retried = await newContext().callAny(hand, "retry_run", { run: "no-such-run" });

    expect(retried).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("at the cap it is refused with the cap in the way, and the Notice stays", async () => {
    // A Run that fails spends nothing: an answer before it brings the month to the cap.
    const costly = answering("word ".repeat(4000));
    const down = failing(UNAVAILABLE);
    scriptModel((...args) => (lastWords(args[0]).startsWith("Spend") ? costly : down)(...args));
    const deployment = newDeployment();
    const work = await makeContext(deployment);
    await sendAndSettle(work, "Spend something");
    await sendAndSettle(work, marked("Are you there?"));
    const [failed] = await messages(work);
    if (failed?.from !== "person" || !failed.notice) throw new Error("No Run failed");
    await deployment.call(hand, "set_spend_cap", { cap: 0.01 });

    const retried = await work.callAny(hand, "retry_run", { run: failed.notice.run });

    expect(retried).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "spend_cap" }] },
    });
    expect((await messages(work))[0]).toMatchObject({ notice: { run: failed.notice.run } });
  });

  test("sent again with the same key, it returns the first result and starts no second Run", async () => {
    let down = true;
    const faux = scriptModel(failingWhile(() => down, UNAVAILABLE));
    const context = newContext();
    await sendAndSettle(context, marked("Are you there?"));
    const [failed] = await messages(context);
    if (failed?.from !== "person" || !failed.notice) throw new Error("No Run failed");
    down = false;
    const input = { run: failed.notice.run, key: "retry-1" };

    const first = await context.callAny(hand, "retry_run", input);
    await context.runsEnded();
    const asked = faux.state.callCount;
    const again = await context.callAny(hand, "retry_run", input);
    await context.runsEnded();

    expect(again).toEqual(first);
    expect(faux.state.callCount).toBe(asked);
  });
});

describe("list_notices", () => {
  test("a Deployment in good order has none", async () => {
    expect(value(await newContext().call(hand, "list_notices", {})).items).toEqual([]);
  });

  test("past 80% of the cap, and at the cap, the month's spend against it", async () => {
    scriptModel(answering("word ".repeat(4000)));
    const deployment = newDeployment();
    const work = await makeContext(deployment);
    await sendAndSettle(work, "Spend something");
    const { spent } = value(await deployment.call(hand, "get_spend", {}));

    const nearing = Math.ceil((spent / 0.9) * 100) / 100;
    await deployment.call(hand, "set_spend_cap", { cap: nearing });
    const warned = value(await work.call(hand, "list_notices", {})).items;
    await deployment.call(hand, "set_spend_cap", { cap: 0.01 });
    const capped = value(await work.call(hand, "list_notices", {})).items;

    expect(warned).toEqual([{ kind: "nearing_cap", spent, cap: nearing }]);
    expect(capped).toEqual([{ kind: "cap_reached", spent, cap: 0.01 }]);
  });
});
