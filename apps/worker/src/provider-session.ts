import { DEVICE_SENDS } from "@praxis/domain";
import { VOICE_INSTRUCTIONS, VOICE_MODEL } from "./voice/gpt-live-1.1.ts";

// Setting a Call's session up at the voice provider: what it is set up with, and the request that
// does it. Apart from the side channel, and free of the Worker's own types, so the voice provider's
// contract sets a session up by hand exactly as the object does (e2e/voice-contract.spec.ts).
//
// The provider's word is session; Praxis's is Call. A Call has one session at the provider.

/**
 * What the Context's object asks the voice provider for when it sets a Call up (section 6): a
 * session on the voice model with its instructions, which hands over to Praxis rather than to a
 * backend the provider runs, lets the Device send only the Agent's answer and the end of the Call,
 * stores nothing, and is never put on standby, so a Call is counted at one rate. It starts blank,
 * given nothing from the Journal or the Conversation. `offer` is the Device's WebRTC offer.
 */
export function sessionRequest(offer: string) {
  return {
    session: {
      model: VOICE_MODEL,
      instructions: VOICE_INSTRUCTIONS,
      delegation: { type: "client" },
      client: { data_channel: { allowed_client_events: [...DEVICE_SENDS] } },
      store: false,
    },
    transport: { type: "webrtc", sdp: offer },
  } as const;
}

export type SessionRequest = ReturnType<typeof sessionRequest>;

/** A session the provider set up for a Call: its id, and its answer to the Device's offer. */
export type ProviderSession = { session: string; answer: string };

/**
 * Why the provider set no session up: it refused the voice key, which the person mends in the
 * configuration, or it could not be reached or would not answer, which only waiting mends.
 */
export type VoiceRefusal = "key_refused" | "unavailable";

/** Where OpenAI sets GPT-Live sessions up. */
export const SESSIONS = "https://api.openai.com/v1/live/sessions";

/** Set a session up at OpenAI with the voice key, answering the Device's offer. */
export async function setUpSession(
  key: string,
  request: SessionRequest,
): Promise<ProviderSession | VoiceRefusal> {
  let response: Response;
  try {
    response = await fetch(SESSIONS, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return "unavailable";
  }
  if (response.status === 401 || response.status === 403) return "key_refused";
  if (!response.ok) return "unavailable";
  const made = (await response.json().catch(() => null)) as {
    session?: { id?: unknown };
    transport?: { sdp?: unknown };
  } | null;
  const session = made?.session?.id;
  const answer = made?.transport?.sdp;
  if (typeof session !== "string" || typeof answer !== "string") return "unavailable";
  return { session, answer };
}
