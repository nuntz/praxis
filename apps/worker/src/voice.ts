import type { ProviderEnd } from "@praxis/domain";
import {
  type ProviderSession,
  SESSIONS,
  type SessionRequest,
  setUpSession,
  type VoiceRefusal,
} from "./provider-session.ts";

/**
 * The voice provider, as the Context's object reaches it (section 6, ADR 0021): with the voice key,
 * which never reaches a Device. One of the faked things (section 13): the real one is OpenAI's, and
 * the tests' is `test/voice-fake.ts`. The object holds no connection to it while a Call goes on.
 */
export interface VoiceProvider {
  /** Set a session up for a Call, answering the Device's offer. */
  setUp(request: SessionRequest): Promise<ProviderSession | VoiceRefusal>;
  /**
   * End a session the Device did not, on the provider's side channel, having the voice say
   * `saying` first when given: what the provider said as it ended it, or null when it said nothing
   * in time or could not be reached, as for a session gone already. Every sound the side channel
   * sends meanwhile is dropped unread.
   */
  end(session: string, saying?: string): Promise<ProviderEnd>;
}

/** What the Deployment's configuration says of the voice provider: its key, a secret. */
export type VoiceConfiguration = { VOICE_API_KEY?: string };

/** How long the object waits to hear the provider end a session, before it lets go. */
export const END_WAIT = 15_000;

/**
 * How long the object gives the voice to say what it is given before it closes the session: a
 * sentence or two, spoken. The provider acknowledges the text when it is taken in, not when it has
 * been spoken, so the object can only wait.
 */
export const SAY_WAIT = 8_000;

/**
 * Whether a side channel event is the provider saying the session has ended. Everything else on
 * the side channel, its copies of the sound both ways among it, is dropped without being parsed:
 * an event's type is in its text, and a sound's frames, in base64, can hold no quote.
 */
const SESSION_ENDED = /"type"\s*:\s*"session\.closed"/;

/**
 * Open the side channel to a session with the key, accepted, or null when the provider does not
 * let the object attach. Passed in, so a test can stand in a socket of its own for the provider's.
 */
export type Attach = (session: string, key: string) => Promise<WebSocket | null>;

/** The provider's side channel, reached as a Worker opens any WebSocket: by fetch, upgraded. */
const attachToProvider: Attach = async (session, key) => {
  const response = await fetch(`${SESSIONS}/${encodeURIComponent(session)}/attach`, {
    headers: { upgrade: "websocket", authorization: `Bearer ${key}` },
  });
  const socket = response.webSocket;
  if (response.status !== 101 || socket === null) return null;
  socket.accept();
  return socket;
};

/**
 * OpenAI's GPT-Live, reached with the Deployment's voice key, or null without one: there is then
 * no way to start a Call (section 6). The key is read from the configuration and is never kept in
 * an object's storage.
 */
export function openAiVoice(
  env: VoiceConfiguration,
  attach: Attach = attachToProvider,
): VoiceProvider | null {
  const key = env.VOICE_API_KEY?.trim();
  if (!key) return null;
  return {
    setUp: (request) => setUpSession(key, request),
    end: (session, saying) => endOnSideChannel(attach, session, key, { saying }),
  };
}

/**
 * End a session on its side channel and wait to hear it ended, dropping unread every sound sent
 * meanwhile, the few seconds of it replayed on attaching included (ADR 0021). Given `saying`, the
 * voice is given it to speak, outside any handover, and the session is closed once it has had
 * `sayFor` to say it.
 */
export async function endOnSideChannel(
  attach: Attach,
  session: string,
  key: string,
  options: { wait?: number; saying?: string | undefined; sayFor?: number } = {},
): Promise<ProviderEnd> {
  const { wait = END_WAIT, saying, sayFor = SAY_WAIT } = options;
  let socket: WebSocket | null;
  try {
    socket = await attach(session, key);
  } catch {
    return null;
  }
  if (socket === null) return null;
  const attached = socket;
  return new Promise((resolve) => {
    let done = false;
    const finish = (heard: ProviderEnd) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        attached.close(1000, "Ended");
      } catch {
        // Gone already, the provider's doing.
      }
      resolve(heard);
    };
    let timer = setTimeout(() => finish(null), sayFor + wait);
    attached.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || !SESSION_ENDED.test(event.data)) return;
      let reason: unknown = null;
      try {
        reason = (JSON.parse(event.data) as { reason?: unknown }).reason;
      } catch {
        // Not the event it looked like: the session has still ended.
      }
      finish({ reason: typeof reason === "string" ? reason : null });
    });
    attached.addEventListener("close", () => finish(null));
    attached.addEventListener("error", () => finish(null));
    const close = () => {
      if (done) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish(null), wait);
      try {
        attached.send(JSON.stringify({ type: "session.close" }));
      } catch {
        finish(null);
      }
    };
    if (saying === undefined) return close();
    try {
      attached.send(
        JSON.stringify({ type: "session.commentary.append", delegation_id: null, content: saying }),
      );
    } catch {
      return close();
    }
    setTimeout(close, sayFor);
  });
}
