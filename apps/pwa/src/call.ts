import {
  type AgentMessage,
  type CALL_ENDS_REPORTED,
  type CallStarted,
  DEVICE_SENDS,
  type ProviderEnd,
  spokenParts,
} from "@praxis/domain";
import type { CallTool } from "./tools.ts";

// The Device's end of a Call (section 6, ADR 0021). The sound travels between this Device and the
// voice provider, over WebRTC, and is never kept. On its own channel to the provider the Device
// follows the text of what is said and the handovers: at each handover it sends everything said
// since the last one to the Agent as a Message, marked as spoken, and passes the Agent's Message
// back under that handover, to be spoken. It sends the provider nothing else but the end of the
// Call. The voice key never reaches it: the Context's object sets the Call up.

/** How a Call ends, as the Device reports it. */
export type DeviceCallEnd = (typeof CALL_ENDS_REPORTED)[number];

/** How long the Device waits to hear the provider end a session it asked to end. */
const END_WAIT = 15_000;

/** How long the Device waits for its offer to gather the ways the provider may reach it. */
const GATHER_WAIT = 5_000;

/**
 * How long after a handover the Device waits for the last of the text of what was said, which may
 * come just behind it.
 */
const SETTLE = 300;

/** The data channel the provider's events and the Device's travel on. */
const EVENTS = "oai-events";

/** What a Call needs from the screen it is shown on. */
export type CallHooks = {
  /**
   * Send everything the person said since the last handover to the Agent, as a spoken Message:
   * the Message's id once it is added, or null when it was not.
   */
  ask(words: string): Promise<string | null>;
  /** The Call has ended, with the provider's reason when it gave one, and the object is told. */
  ended(end: { ended: DeviceCallEnd; reason: string | null }): void;
};

/** One fragment of the text of what the person said, and when in the session it began. */
type Heard = { words: string; from: number };

/** An event the provider sends on the Device's channel, as far as the Device reads it. */
type ProviderEvent =
  | { type: "session.input_transcript.delta"; delta: string; start_ms?: number }
  | { type: "session.delegation.created"; delegation: { id: string }; offset_ms?: number }
  | { type: "session.closed"; reason?: string }
  | { type: string };

/** An event the Device sends the provider: only these two kinds, ever. */
type DeviceEvent =
  | { type: "session.commentary.append"; delegation_id: string; content: string }
  | { type: "session.close" };

/** A Call going on this Device, in one Context. */
export class DeviceCall {
  readonly id: string;
  readonly #callTool: CallTool;
  readonly #hooks: CallHooks;
  readonly #connection: RTCPeerConnection;
  readonly #channel: RTCDataChannel;
  readonly #microphone: MediaStream;
  readonly #audio: HTMLAudioElement;
  /** What the person said since the last handover, in fragments, in the order they came. */
  #heard: Heard[] = [];
  /** Each handover not yet answered, by its id. */
  readonly #unanswered = new Set<string>();
  /** The handover each Message sent was sent for, by the Message's id. */
  readonly #handoverOf = new Map<string, string>();
  /** An answer that came before `send_message` said which Message it was, by that Message. */
  readonly #early = new Map<string, AgentMessage>();
  /** Set while the person hangs up: the Device waits to hear the provider end the session. */
  #ending: ((end: ProviderEnd) => void) | null = null;
  #ended = false;

  private constructor(
    started: CallStarted,
    callTool: CallTool,
    hooks: CallHooks,
    parts: {
      connection: RTCPeerConnection;
      channel: RTCDataChannel;
      microphone: MediaStream;
      audio: HTMLAudioElement;
    },
  ) {
    this.id = started.id;
    this.#callTool = callTool;
    this.#hooks = hooks;
    this.#connection = parts.connection;
    this.#channel = parts.channel;
    this.#microphone = parts.microphone;
    this.#audio = parts.audio;
  }

  /**
   * Start a Call in the Context these tools reach: take the microphone, offer the provider a
   * connection, and have the Context's object set the Call up with it. The Call, or why there is
   * none, in words for the person.
   */
  static async start(callTool: CallTool, hooks: CallHooks): Promise<DeviceCall | string> {
    let microphone: MediaStream;
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return "Praxis could not use this Device's microphone, so no Call was started. Allow it in the browser's settings and try again.";
    }
    const connection = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    connection.addEventListener("track", (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => {});
    });
    for (const track of microphone.getAudioTracks()) connection.addTrack(track, microphone);
    // Made before the offer, so the offer holds it.
    const channel = connection.createDataChannel(EVENTS);
    const stop = () => {
      for (const track of microphone.getTracks()) track.stop();
      connection.close();
    };
    let started: CallStarted;
    try {
      await connection.setLocalDescription(await connection.createOffer());
      const offer = await gathered(connection);
      const result = await callTool("start_call", { offer });
      if (!result.ok) {
        stop();
        return result.error.message;
      }
      started = result.value.call;
      await connection.setRemoteDescription({ type: "answer", sdp: started.answer });
    } catch {
      stop();
      return "The Call could not be connected. Try again in a while.";
    }
    const call = new DeviceCall(started, callTool, hooks, {
      connection,
      channel,
      microphone,
      audio,
    });
    call.#follow();
    return call;
  }

  /** Follow the provider's channel and the connection, for as long as the Call goes on. */
  #follow(): void {
    this.#channel.addEventListener("message", (event) => {
      let parsed: ProviderEvent;
      try {
        parsed = JSON.parse(String(event.data)) as ProviderEvent;
      } catch {
        return;
      }
      this.#hear(parsed);
    });
    // The channel gone without the provider saying the session ended: the connection was lost.
    this.#channel.addEventListener("close", () => this.#lose());
    this.#connection.addEventListener("connectionstatechange", () => {
      if (this.#connection.connectionState === "failed") this.#lose();
    });
    // Leaving Praxis ends a Call (section 6): the tab hidden, the screen locked, the network gone.
    // That, two minutes of silence, the cap and the sign of life are #80's.
  }

  #hear(event: ProviderEvent): void {
    switch (event.type) {
      case "session.input_transcript.delta": {
        const { delta, start_ms } = event as Extract<ProviderEvent, { delta: string }>;
        this.#heard.push({ words: delta, from: start_ms ?? Number.NEGATIVE_INFINITY });
        return;
      }
      case "session.delegation.created": {
        const { delegation, offset_ms } = event as Extract<ProviderEvent, { delegation: object }>;
        void this.#handOver(delegation.id, offset_ms ?? Number.POSITIVE_INFINITY);
        return;
      }
      case "session.closed": {
        const reason = (event as { reason?: unknown }).reason;
        const heard = { reason: typeof reason === "string" ? reason : null };
        // Ended as the Device asked, or by the provider itself.
        if (this.#ending) this.#ending(heard);
        else void this.#finish("provider_ended", heard);
        return;
      }
      // What the voice model says by itself, its own words' text among it, is not kept.
    }
  }

  /**
   * A handover: send the Agent everything said before it since the last one, as one spoken
   * Message, nothing left out, once the last of its text has had a moment to come.
   */
  async #handOver(handover: string, at: number): Promise<void> {
    this.#unanswered.add(handover);
    await new Promise((settled) => setTimeout(settled, SETTLE));
    const said = this.#heard.filter(({ from }) => from < at);
    this.#heard = this.#heard.filter(({ from }) => from >= at);
    const words = joined(said.map(({ words }) => words));
    // A handover with nothing said before it asks the Agent nothing, and waits unanswered.
    if (words === "" || this.#ended) return;
    const message = await this.#hooks.ask(words);
    if (message === null) return;
    this.#handoverOf.set(message, handover);
    const early = this.#early.get(message);
    if (early) {
      this.#early.delete(message);
      this.answer(early);
    }
  }

  /**
   * An Agent's Message, as the screen shows it: one that answers a Message sent in this Call, once
   * its Run has ended, is passed back under its handover, split at sentences into parts the
   * provider takes. A Message answering anything else is answered in writing only.
   */
  answer(message: AgentMessage): void {
    if (this.#ended || message.answers === null || message.run.ended === null) return;
    const handover = this.#handoverOf.get(message.answers);
    if (handover === undefined) {
      this.#early.set(message.answers, message);
      return;
    }
    this.#handoverOf.delete(message.answers);
    // A Run that failed has no Message to speak: the voice saying so is #80's.
    this.#speak(handover, message.words);
  }

  /** Give the voice model the Agent's answer to speak, under the one handover it answers. */
  #speak(handover: string, words: string): void {
    if (!this.#unanswered.delete(handover)) return;
    for (const content of spokenParts(words)) {
      this.#send({ type: "session.commentary.append", delegation_id: handover, content });
    }
  }

  /**
   * Send the provider an event: only the Agent's answer and the end of the Call, ever, which is
   * all the object lets this Device send. Anything else is a fault in Praxis's own code.
   */
  #send(event: DeviceEvent): void {
    if (!(DEVICE_SENDS as readonly string[]).includes(event.type)) {
      throw new Error(`The Device may not send the voice provider ${event.type}`);
    }
    if (this.#channel.readyState !== "open") return;
    this.#channel.send(JSON.stringify(event));
  }

  /** Whether the Device's microphone is turned off. */
  get muted(): boolean {
    return this.#microphone.getAudioTracks().every((track) => !track.enabled);
  }

  /** Turn the Device's microphone track off, or on again: the Call goes on either way. */
  mute(muted: boolean): void {
    for (const track of this.#microphone.getAudioTracks()) track.enabled = !muted;
  }

  /**
   * The person hangs up: the Device ends the session at the provider and waits to hear it ended,
   * then reports the end, saying whether it heard.
   */
  async hangUp(): Promise<void> {
    if (this.#ended || this.#ending) return;
    let heard: (end: ProviderEnd) => void = () => {};
    const ended = new Promise<ProviderEnd>((resolve) => {
      const timer = setTimeout(() => resolve(null), END_WAIT);
      heard = (end) => {
        clearTimeout(timer);
        resolve(end);
      };
    });
    this.#ending = heard;
    if (this.#channel.readyState === "open") this.#send({ type: "session.close" });
    else heard(null);
    await this.#finish("hung_up", await ended);
  }

  /** The connection went without the provider saying the session ended. */
  #lose(): void {
    if (this.#ending) this.#ending(null);
    else void this.#finish("lost", null);
  }

  /**
   * End the Call on this Device, once: let go of the microphone and the connection, and report the
   * end to the object, which ends the session itself when the Device did not hear it end.
   */
  async #finish(ended: DeviceCallEnd, heard: ProviderEnd): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    for (const track of this.#microphone.getTracks()) track.stop();
    this.#audio.srcObject = null;
    this.#connection.close();
    try {
      await this.#callTool("end_call", { call: this.id, ended, provider_end: heard });
    } catch {
      // Not reached: the object ends a Call whose Device went silent itself (#80).
    }
    this.#hooks.ended({ ended, reason: heard?.reason ?? null });
  }
}

/**
 * The text of what was said, from its fragments as the provider gave them: as they come, but for a
 * space where one ends a sentence and the next begins with none, as two things said apart do.
 */
function joined(fragments: string[]): string {
  return fragments
    .reduce(
      (text, fragment) =>
        /[.!?…]$/u.test(text) && /^\S/u.test(fragment) ? `${text} ${fragment}` : text + fragment,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The connection's offer once it holds the ways the provider may reach it, or as it stands. */
async function gathered(connection: RTCPeerConnection): Promise<string> {
  if (connection.iceGatheringState !== "complete") {
    await new Promise<void>((done) => {
      const timer = setTimeout(done, GATHER_WAIT);
      connection.addEventListener("icegatheringstatechange", () => {
        if (connection.iceGatheringState !== "complete") return;
        clearTimeout(timer);
        done();
      });
    });
  }
  const sdp = connection.localDescription?.sdp;
  if (!sdp) throw new Error("No offer was made");
  return sdp;
}
