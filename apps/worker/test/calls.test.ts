import type { CallRecord, CallStarted, MessagesPage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { VOICE_INSTRUCTIONS, VOICE_MODEL } from "../src/voice/gpt-live-1.1.ts";
import { noModel } from "./model-fake.ts";
import { hand, newContext, value } from "./seam.ts";
import {
  FAKE_ANSWER,
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

type Context = ReturnType<typeof newContext>;

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

  // Until #80 holds one Call to the whole Deployment, starting one ends any other in this Context.
  test("ends a Call going in this Context, at the provider, before setting the next up", async () => {
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

  test("a Call is counted from setting it up until the Device reports its end", async () => {
    const context = newContext();
    const call = await started(context);
    context.advance(90_000);

    const record = await ended(context, {
      call: call.id,
      ended: "hung_up",
      provider_end: { reason: "close_requested" },
    });

    expect(Date.parse(record.ended_at ?? "") - Date.parse(record.at)).toBe(90_000);
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
