import type { ProviderEnd } from "@praxis/domain";
import type { SessionRequest, VoiceRefusal } from "../src/provider-session.ts";
import type { VoiceProvider } from "../src/voice.ts";

// The voice provider is one of the faked things (section 13). This is its end at the Context's
// object: it sets a session up for each Call, answering the Device's offer with one of its own, and
// keeps what it was asked for and which sessions the object ended on the side channel, so a test
// reads both. The Device's end is faked in the browser, with scripted text and no sound
// (e2e/voice-fake.ts). It runs in the tests' own isolate, as the scripted model does.

/** A session the fake set up: what the object asked for, and whether it has ended it since. */
export type FakeSession = { id: string; request: SessionRequest; endedByObject: boolean };

const sessions: FakeSession[] = [];
let present = true;
let refusing: VoiceRefusal | null = null;
let ending: ProviderEnd = { reason: "close_requested" };
/** What setting a session up waits on: nothing, unless a test holds it. */
let held: Promise<void> = Promise.resolve();

/** The fake's answer to every offer: an SDP of its own, which the Device's fake takes. */
export const FAKE_ANSWER = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=voice-fake\r\n";

const fakeVoice: VoiceProvider = {
  async setUp(request) {
    await held;
    if (refusing !== null) return refusing;
    const id = `live_${crypto.randomUUID()}`;
    sessions.push({ id, request, endedByObject: false });
    return { session: id, answer: FAKE_ANSWER };
  },
  async end(session) {
    const found = sessions.find(({ id }) => id === session);
    if (found === undefined) {
      throw new Error(`The object ended a session the fake never set up: ${session}`);
    }
    found.endedByObject = true;
    return ending;
  },
};

/** The voice provider of a Deployment with the voice key, or none while a test says it has none. */
export function testVoice(): VoiceProvider | null {
  return present ? fakeVoice : null;
}

/** Every session set up so far, oldest first. */
export function voiceSessions(): readonly FakeSession[] {
  return sessions;
}

/** Stand for a Deployment with no voice key, or with one again. */
export function setVoicePresent(to: boolean): void {
  present = to;
}

/** Make the provider refuse to set a session up, as it does a refused key or in an outage. */
export function setVoiceRefusing(to: VoiceRefusal | null): void {
  refusing = to;
}

/** What the provider says when the object ends a session, or null for its saying nothing. */
export function setEndReason(to: string | null): void {
  ending = to === null ? null : { reason: to };
}

/**
 * Hold every session being set up until the function returned is called, so a test calls
 * something else while one waits on the provider, as `holdEmbedding()` holds an embedding.
 */
export function holdSetUp(): () => void {
  let release = () => {};
  held = new Promise((resolve) => {
    release = resolve;
  });
  return release;
}

/** Start a test with a voice key, a provider that answers, and no session. */
export function resetVoice(): void {
  sessions.length = 0;
  present = true;
  refusing = null;
  ending = { reason: "close_requested" };
  held = Promise.resolve();
}
