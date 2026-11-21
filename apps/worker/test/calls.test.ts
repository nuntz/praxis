import type { CallRecord, CallStarted, MessagesPage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { CAP_SAID } from "../src/context-object.ts";
import { VOICE_INSTRUCTIONS, VOICE_MODEL } from "../src/voice/gpt-live-1.1.ts";
import { noModel } from "./model-fake.ts";
import {
  clock,
  connection,
  contextWithItsDeployment,
  hand,
  newContext,
  newDeployment,
  value,
} from "./seam.ts";
import {
  FAKE_ANSWER,
  holdEnd,
  holdSetUp,
  setEndReason,
  setVoicePresent,
  setVoiceRefusing,
  voiceSessions,
} from "./voice-fake.ts";

// A Call (section 6, ADR 0021): the Context's object sets it up at the voice provider, the Device
// carries it, and the object keeps a record of it with no words. The Device's end is the journeys'
// (e2e/call.spec.ts).

const OFFER = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=device\r\n";

/** A Context as a test reaches it, made alone or in a Deployment it shares. */
type Context = Pick<ReturnType<typeof newContext>, "callAny">;

async function started(context: Context, input: object = {}): Promise<CallStarted> {
  const result = await context.callAny(hand, "start_call", { offer: OFFER, ...input });
  return (value(result) as { call: CallStarted }).call;
}

async function ended(context: Context, input: object): Promise<CallRecord> {
  return (value(await context.callAny(hand, "end_call", input)) as { call: CallRecord }).call;
}

describe("start_call", () => {
  test("sets the Call up at the provider, on the voice model with its instructions, letting the Device send only the answer and the end, and answers its offer", async () => {
    const context = newContext();

    const call = await started(context);

    expect(call).toEqual({ id: expect.any(String), answer: FAKE_ANSWER });
    expect(voiceSessions()).toHaveLength(1);
    const { request } = voiceSessions()[0] ?? {};
    expect(request).toEqual({
      session: {
        model: VOICE_MODEL,
        instructions: VOICE_INSTRUCTIONS,
        delegation: { type: "client" },
        client: {
          data_channel: { allowed_client_events: ["session.commentary.append", "session.close"] },
        },
        store: false,
      },
      transport: { type: "webrtc", sdp: OFFER },
    });
  });

  test("is the voice model fixed in the code, priced at five cents a minute, never on standby", async () => {
    const { VOICE_PRICE_PER_MINUTE } = await import("../src/voice/gpt-live-1.1.ts");
    const context = newContext();

    await started(context);

    expect(VOICE_MODEL).toBe("gpt-live-1.1");
    expect(VOICE_PRICE_PER_MINUTE).toBe(0.05);
    const session = voiceSessions()[0]?.request.session ?? {};
    expect(session).not.toHaveProperty("wake_policy");
    expect(session).not.toHaveProperty("idle_timeout_s");
  });

  test("gives the voice model nothing from the Journal or the Conversation: it starts blank", async () => {
    const context = newContext();
    await context.call(hand, "record_entry", { words: "The boiler is broken" });
    await context.callAny(hand, "send_message", { words: "Hello" });
    await context.runsEnded();

    await started(context);

    const asked = JSON.stringify(voiceSessions()[0]?.request);
    expect(asked).not.toContain("boiler");
    expect(asked).not.toContain("Hello");
    expect(voiceSessions()[0]?.request.session).not.toHaveProperty("input");
  });

  test("without the voice key, there is no way to start a Call, and list_messages says so", async () => {
    setVoicePresent(false);
    const context = newContext();

    const result = await context.callAny(hand, "start_call", { offer: OFFER });
    const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;

    expect(result).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(page).toMatchObject({ agent: "available", voice: "no_key" });
    expect(voiceSessions()).toEqual([]);
  });

  test("with the voice key, list_messages says a Call can be started", async () => {
    const page = value(await newContext().callAny(hand, "list_messages", {})) as MessagesPage;

    expect(page.voice).toBe("available");
  });

  test("without the Agent's key there is no Call either", async () => {
    noModel();
    const context = newContext();

    const result = await context.callAny(hand, "start_call", { offer: OFFER });

    expect(result).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(voiceSessions()).toEqual([]);
  });

  test("the provider refusing the voice key is refused, and the person can mend it in the configuration", async () => {
    setVoiceRefusing("key_refused");

    const result = await newContext().callAny(hand, "start_call", { offer: OFFER });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "refused", message: expect.stringMatching(/voice key/) },
    });
  });

  test("the provider unreachable is refused as unavailable, which only waiting mends", async () => {
    setVoiceRefusing("unavailable");

    const result = await newContext().callAny(hand, "start_call", { offer: OFFER });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "refused", message: expect.stringMatching(/try again/i) },
    });
  });

  test("never answers with the voice key", async () => {
    const result = await newContext().callAny(hand, "start_call", { offer: OFFER });

    expect(JSON.stringify(result)).not.toMatch(/key|Bearer/i);
  });

  test("sent again with the same key, sets nothing up twice", async () => {
    const context = newContext();

    const first = await context.callAny(hand, "start_call", { offer: OFFER, key: "call-1" });
    const again = await context.callAny(hand, "start_call", { offer: OFFER, key: "call-1" });

    expect(again).toEqual(first);
    expect(voiceSessions()).toHaveLength(1);
  });

  test("two started at once leave one Call going: the second ends the first", async () => {
    const context = newContext();
    await context.call(hand, "get_settings", {});
    const release = holdSetUp();

    const starting = [
      context.callAny(hand, "start_call", { offer: OFFER }),
      context.callAny(hand, "start_call", { offer: OFFER }),
    ];
    await new Promise((settled) => setTimeout(settled, 50));
    release();
    const both = await Promise.all(starting);

    expect(both.map(({ ok }) => ok)).toEqual([true, true]);
    expect(voiceSessions().map(({ endedByObject }) => endedByObject)).toEqual([true, false]);
  });

  test("an empty offer is invalid input", async () => {
    const result = await newContext().callAny(hand, "start_call", { offer: "" });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("ends a Call going in this Context, at the provider, once the next is set up", async () => {
    const context = newContext();
    const first = await started(context);

    await started(context);

    expect(voiceSessions().map(({ endedByObject }) => endedByObject)).toEqual([true, false]);
    const again = await ended(context, { call: first.id, ended: "lost", provider_end: null });
    expect(again).toMatchObject({ ended: "replaced", end_heard_by: "object" });
  });
});

describe("end_call", () => {
  test("the Device heard the provider end it: the Call ends as the Device says, and the object attaches to nothing", async () => {
    const context = newContext();
    const call = await started(context);

    const record = await ended(context, {
      call: call.id,
      ended: "hung_up",
      provider_end: { reason: "close_requested" },
    });

    expect(record).toEqual({
      id: call.id,
      at: "2026-11-15T09:00:00.000Z",
      ended_at: "2026-11-15T09:00:00.000Z",
      ended: "hung_up",
      seconds: 0,
      cost: 0,
      provider_reason: "close_requested",
      end_heard_by: "device",
    });
    expect(voiceSessions()[0]?.endedByObject).toBe(false);
  });

  test("the Device did not hear it end: the object ends it on the side channel and keeps the provider's reason", async () => {
    const context = newContext();
    const call = await started(context);

    const record = await ended(context, { call: call.id, ended: "lost", provider_end: null });

    expect(voiceSessions()[0]?.endedByObject).toBe(true);
    expect(record).toMatchObject({
      ended: "lost",
      provider_reason: "close_requested",
      end_heard_by: "object",
    });
  });

  test("the Device heard the provider end it with no reason: the object attaches to nothing", async () => {
    const context = newContext();
    const call = await started(context);

    const record = await ended(context, {
      call: call.id,
      ended: "provider_ended",
      provider_end: { reason: null },
    });

    expect(record).toMatchObject({ provider_reason: null, end_heard_by: "device" });
    expect(voiceSessions()[0]?.endedByObject).toBe(false);
  });

  test("the provider saying nothing on the side channel leaves the reason unknown", async () => {
    setEndReason(null);
    const context = newContext();
    const call = await started(context);

    const record = await ended(context, { call: call.id, ended: "hung_up", provider_end: null });

    expect(record).toMatchObject({ ended: "hung_up", provider_reason: null, end_heard_by: null });
  });

  test("the provider ended it by its safety filter: the record keeps the provider's reason", async () => {
    const context = newContext();
    const call = await started(context);

    const record = await ended(context, {
      call: call.id,
      ended: "provider_ended",
      provider_end: { reason: "content" },
    });

    expect(record).toMatchObject({ ended: "provider_ended", provider_reason: "content" });
  });

  test("a Call is counted from setting it up until the Device reports its end: its record says how long and what it cost at five cents a minute", async () => {
    const context = newContext();
    const call = await started(context);
    context.advance(90_000);

    const record = await ended(context, {
      call: call.id,
      ended: "hung_up",
      provider_end: { reason: "close_requested" },
    });

    expect(Date.parse(record.ended_at ?? "") - Date.parse(record.at)).toBe(90_000);
    expect(record.seconds).toBe(90);
    expect(record.cost).toBeCloseTo(0.075, 10);
  });

  test("a part of a second is counted as a whole one, as the provider bills by the second", async () => {
    const context = newContext();
    const call = await started(context);
    context.advance(59_001);

    const record = await ended(context, { call: call.id, ended: "hung_up", provider_end: null });

    expect(record.seconds).toBe(60);
    expect(record.cost).toBeCloseTo(0.05, 10);
  });

  test("reported again, changes nothing and answers with the record as it is", async () => {
    const context = newContext();
    const call = await started(context);
    const first = await ended(context, {
      call: call.id,
      ended: "hung_up",
      provider_end: { reason: "close_requested" },
    });
    context.advance(5_000);

    const again = await ended(context, { call: call.id, ended: "lost", provider_end: null });

    expect(again).toEqual(first);
    expect(voiceSessions()[0]?.endedByObject).toBe(false);
  });

  test("a Call this Context never set up is not found", async () => {
    const result = await newContext().callAny(hand, "end_call", {
      call: "no-such-call",
      ended: "hung_up",
      provider_end: null,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("a reason that is not a word of the provider's is invalid input", async () => {
    const context = newContext();
    const call = await started(context);

    const result = await context.callAny(hand, "end_call", {
      call: call.id,
      ended: "hung_up",
      provider_end: { reason: "Ended, because of what was said" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("counting", () => {
  test("a Call's cost is counted against the month's spend once it ends, on top of the Runs", async () => {
    const { deployment, context } = await contextWithItsDeployment();
    const call = await started(context);
    deployment.advance(10 * 60_000);

    await ended(context, { call: call.id, ended: "hung_up", provider_end: null });

    expect(value(await deployment.call(hand, "get_spend", {})).spent).toBeCloseTo(0.5, 10);
  });

  test("no Call starts at the cap, and the refusal says so with the cap in the way", async () => {
    const { deployment, context } = await contextWithItsDeployment();
    value(await deployment.call(hand, "set_spend_cap", { cap: 0.1 }));
    const call = await started(context);
    deployment.advance(3 * 60_000);
    await ended(context, { call: call.id, ended: "hung_up", provider_end: null });

    const refused = await context.callAny(hand, "start_call", { offer: OFFER });

    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: "refused",
        message: expect.stringMatching(/cap/),
        in_the_way: [expect.objectContaining({ kind: "spend_cap" })],
      },
    });
    expect(voiceSessions()).toHaveLength(1);
  });
});

/** Two Contexts made by the hand in one Deployment. */
async function twoContexts() {
  const deployment = newDeployment();
  const made = async (name: string) =>
    deployment.context(
      value(
        await deployment.call(hand, "create_context", { name, time_zone: "UTC", accent: "blue" }),
      ).record.id,
    );
  return { deployment, work: await made("Work"), home: await made("Home") };
}

async function alive(context: Context, call: string): Promise<CallRecord> {
  return (value(await context.callAny(hand, "note_call_alive", { call })) as { call: CallRecord })
    .call;
}

describe("one Call at a time for the Deployment", () => {
  test("starting a Call in one Context ends the one going in another, at the provider", async () => {
    const { work, home } = await twoContexts();
    const first = await started(work);

    await started(home);

    expect(voiceSessions().map(({ endedByObject }) => endedByObject)).toEqual([true, false]);
    expect(await alive(work, first.id)).toMatchObject({
      ended: "replaced",
      end_heard_by: "object",
    });
  });

  test("a Call that has ended is not ended again when the next starts", async () => {
    const { work, home } = await twoContexts();
    const first = await started(work);
    await ended(work, { call: first.id, ended: "hung_up", provider_end: { reason: null } });

    await started(home);

    expect(voiceSessions().map(({ endedByObject }) => endedByObject)).toEqual([false, false]);
  });

  test("two started at once in two Contexts leave one Call going: the later ends the earlier", async () => {
    const { work, home } = await twoContexts();
    const release = holdSetUp();

    const starting = [started(work), started(home)];
    await new Promise((settled) => setTimeout(settled, 50));
    release();
    const [first, second] = await Promise.all(starting);

    const records = [await alive(work, first?.id ?? ""), await alive(home, second?.id ?? "")];
    expect(records.filter(({ ended }) => ended === null)).toHaveLength(1);
    expect(records.filter(({ ended }) => ended === "replaced")).toHaveLength(1);
  });
});

describe("ending a Call twice", () => {
  test("a Call the object is ending when the Device reports its end is ended once, as it was first", async () => {
    const { work, home } = await twoContexts();
    const first = await started(work);
    const release = holdEnd();
    // The next Call has the object end this one at the provider, which is held.
    const next = started(home);
    await new Promise((settled) => setTimeout(settled, 50));

    const reported = await ended(work, { call: first.id, ended: "hung_up", provider_end: null });
    release();
    await next;

    expect(reported).toMatchObject({ ended: "replaced" });
    expect(voiceSessions()[0]?.timesEnded).toBe(1);
    expect(await alive(work, first.id)).toMatchObject({
      ended: "replaced",
      end_heard_by: "object",
    });
  });
});

describe("note_call_alive", () => {
  test("answers with the Call's record while it goes on", async () => {
    const context = newContext();
    const call = await started(context);

    const record = await alive(context, call.id);

    expect(record).toMatchObject({ id: call.id, ended: null, seconds: null, cost: null });
  });

  test("with no sign of life for 45 seconds, the object ends the Call at the provider itself", async () => {
    const context = newContext();
    const call = await started(context);
    context.advance(30_000);
    await alive(context, call.id);
    context.advance(44_000);
    await context.fireAlarm();
    expect(voiceSessions()[0]?.endedByObject).toBe(false);

    context.advance(1_000);
    await context.fireAlarm();

    expect(voiceSessions()[0]?.endedByObject).toBe(true);
    expect(await alive(context, call.id)).toMatchObject({
      ended: "no_sign_of_life",
      seconds: 75,
      provider_reason: "close_requested",
      end_heard_by: "object",
    });
  });

  test("a Call going as the month turns counts in each month for its time in it, so the new month's cap ends it", async () => {
    const { deployment, context } = await contextWithItsDeployment("2026-11-30T23:59:00.000Z");
    const call = await started(context);
    deployment.advance(60_000);
    await alive(context, call.id);
    value(await deployment.call(hand, "set_spend_cap", { cap: 0.04 }));
    deployment.advance(30_000);
    expect(await alive(context, call.id)).toMatchObject({ ended: null });
    deployment.advance(30_000);

    const record = await alive(context, call.id);

    expect(record).toMatchObject({ ended: "cap_reached", seconds: 120 });
    expect(value(await deployment.call(hand, "get_spend", {}))).toMatchObject({
      month: "2026-12",
      spent: expect.closeTo(0.05, 10),
    });
  });

  test("a Call ended late by the object is counted no longer than the provider's two-hour limit", async () => {
    const context = newContext();
    const call = await started(context);
    context.advance(3 * 60 * 60_000);
    await context.fireAlarm();

    expect(await alive(context, call.id)).toMatchObject({
      ended: "no_sign_of_life",
      seconds: 7200,
      cost: expect.closeTo(6, 10),
    });
  });

  test("a Call going is counted as it goes: its time so far is in the month's spend", async () => {
    const { deployment, context } = await contextWithItsDeployment();
    const call = await started(context);
    deployment.advance(60_000);

    await alive(context, call.id);

    expect(value(await deployment.call(hand, "get_spend", {})).spent).toBeCloseTo(0.05, 10);
  });

  test("at the cap, the object has the voice say so, then ends the Call at the provider", async () => {
    const { deployment, context } = await contextWithItsDeployment();
    value(await deployment.call(hand, "set_spend_cap", { cap: 0.1 }));
    const call = await started(context);
    deployment.advance(60_000);
    expect(await alive(context, call.id)).toMatchObject({ ended: null });
    deployment.advance(90_000);

    const record = await alive(context, call.id);

    expect(record).toMatchObject({ ended: "cap_reached", seconds: 150, end_heard_by: "object" });
    expect(voiceSessions()[0]).toMatchObject({ endedByObject: true, saidAtEnd: CAP_SAID });
    expect(CAP_SAID).toMatch(/cap/);
  });

  test("a Call ended by the Device is answered as it ended", async () => {
    const context = newContext();
    const call = await started(context);
    const done = await ended(context, { call: call.id, ended: "left", provider_end: null });

    expect(await alive(context, call.id)).toEqual(done);
  });

  test("a Call this Context never set up is not found", async () => {
    const result = await newContext().callAny(hand, "note_call_alive", { call: "no-such-call" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("the voice key", () => {
  test("refused by the provider, is a standing Notice in every Context, until a Call is set up", async () => {
    const { work, home } = await twoContexts();
    setVoiceRefusing("key_refused");
    await work.callAny(hand, "start_call", { offer: OFFER });

    const notices = value(await home.call(hand, "list_notices", {})).items;

    expect(notices).toEqual([{ kind: "voice_key_refused", since: "2026-11-15T09:00:00.000Z" }]);
    setVoiceRefusing(null);
    await started(home);
    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([]);
  });

  test("the provider unreachable leaves no standing Notice", async () => {
    const context = newContext();
    setVoiceRefusing("unavailable");
    await context.callAny(hand, "start_call", { offer: OFFER });

    expect(value(await context.call(hand, "list_notices", {})).items).toEqual([]);
  });
});

describe("a Connection", () => {
  test("can neither start a Call nor see one: no Call tool is offered to it, nor to the Agent or the clock", async () => {
    const context = newContext();
    const call = await started(context);

    for (const caller of [connection, clock]) {
      for (const [tool, input] of [
        ["start_call", { offer: OFFER }],
        ["note_call_alive", { call: call.id }],
        ["end_call", { call: call.id, ended: "hung_up", provider_end: null }],
      ] as const) {
        expect(await context.callAny(caller, tool, input)).toMatchObject({
          ok: false,
          error: { code: "not_offered" },
        });
      }
    }
    expect(voiceSessions()).toHaveLength(1);
    expect(await alive(context, call.id)).toMatchObject({ ended: null });
  });
});
