import {
  type CALL_ENDS_REPORTED,
  type CallRecord,
  type CallStarted,
  DEVICE_SENDS,
  type Message,
  type ProviderEnd,
  type RunNotice,
  SIGN_OF_LIFE_EVERY,
  SILENCE_ENDS_CALL,
  spokenParts,
} from "@praxis/domain";
import type { CallTool } from "./tools.ts";

// The Device's end of a Call (section 6, ADR 0021). The sound travels between this Device and the
// voice provider, over WebRTC, and is never kept. On its own channel to the provider the Device
// follows the text of what is said and the handovers: at each handover it sends everything said
// since the last one to the Agent as a Message, marked as spoken, and passes the Agent's Message
// back under that handover, to be spoken, or what Praxis has to say when there is none: the Message
// refused, or its Run failed. It sends the provider nothing else but the end of the Call. The voice
// key never reaches it: the Context's object sets the Call up. While the Call goes on it sends the
// object a sign of life and keeps the screen awake, so the Device does not lock it by itself, and it
// ends the Call itself on leaving Praxis and after two minutes of silence; the object ends it when
// the Device falls silent, at the cap, and when another starts.

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
   * the Message's id once it is added, or, when it was not, why, in words the voice can say.
   */
  ask(words: string): Promise<{ message: string } | { refused: string }>;
  /** What the Notice under a Message whose Run failed says, which the voice says too. */
  failed(notice: RunNotice): string;
  /**
   * The Call has ended: how, as this Device saw it, with the provider's reason when it gave one,
   * and the Call's record as the object answered, or null when it could not be reached.
   */
  ended(end: { ended: DeviceCallEnd; reason: string | null; record: CallRecord | null }): void;
};

/** One fragment of the text of what the person said, and when in the session it began. */
type Heard = { words: string; from: number };

/** An event the provider sends on the Device's channel, as far as the Device reads it. */
type ProviderEvent =
  | { type: "session.input_transcript.delta"; delta: string; start_ms?: number }
  | { type: "session.output_transcript.delta" }
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
  /**
   * When the object set the Call up, by this Device's clock, as `start_call` answered: the time so
   * far is counted from it.
   */
  readonly since: number;
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
  readonly #early = new Map<string, Message>();
  /**
   * When something was last said, by the person or the voice, or handed over, or given to be
   * spoken, by this clock.
   */
  #lastSaid = Date.now();
  /** The sign of life, sent while the Call goes on. */
  #signOfLife: ReturnType<typeof setInterval> | undefined;
  /** Leaving Praxis ends the Call: what is listened for, to stop listening once it has ended. */
  readonly #leaving = (event: Event) => {
    if (event.type === "visibilitychange" && document.visibilityState !== "hidden") return;
    void this.#close("left");
  };
  /** The wake lock on the screen while the Call goes on, once the Device has granted it. */
  #wakeLock: WakeLockSentinel | null = null;
  /** Set while the person hangs up: the Device waits to hear the provider end the session. */
  #ending: ((end: ProviderEnd) => void) | null = null;
  #ended = false;

  private constructor(
    started: CallStarted,
    since: number,
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
    this.since = since;
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
    let since: number;
    try {
      await connection.setLocalDescription(await connection.createOffer());
      const offer = await gathered(connection);
      const result = await callTool("start_call", { offer });
      since = Date.now();
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
    const call = new DeviceCall(started, since, callTool, hooks, {
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
    document.addEventListener("visibilitychange", this.#leaving);
    window.addEventListener("pagehide", this.#leaving);
    window.addEventListener("offline", this.#leaving);
    this.#signOfLife = setInterval(() => void this.#alive(), SIGN_OF_LIFE_EVERY);
    void this.#keepAwake();
  }

  /**
   * Keep the screen awake, so the Device does not lock it by itself and end the Call. A Device that
   * will not has the Call all the same. One that releases it while Praxis is still shown is asked
   * again; hidden, the Call is ending anyway.
   */
  async #keepAwake(): Promise<void> {
    let wakeLock: WakeLockSentinel;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      return;
    }
    // Answered after the Call ended.
    if (this.#ended) {
      void wakeLock.release();
      return;
    }
    this.#wakeLock = wakeLock;
    wakeLock.addEventListener("release", () => {
      if (this.#ended || document.visibilityState === "hidden") return;
      void this.#keepAwake();
    });
  }

  /**
   * Every 15 seconds: end the Call after about two minutes in which nothing was said, an answer
   * awaited for that long included, or send the object a sign of life. An answer saying the object has ended the Call,
   * as at the cap, ends this end of it. One not answered is let be: the object ends the Call once it
   * has heard nothing for long enough.
   */
  async #alive(): Promise<void> {
    if (this.#ended || this.#ending) return;
    if (Date.now() - this.#lastSaid >= SILENCE_ENDS_CALL) {
      return this.#close("silence");
    }
    try {
      const result = await this.#callTool("note_call_alive", { call: this.id });
      if (result.ok && result.value.call.ended !== null) this.#endedByObject(result.value.call);
    } catch {
      // Unanswered: the next one may be.
    }
  }

  #hear(event: ProviderEvent): void {
    switch (event.type) {
      case "session.output_transcript.delta":
        // What the voice says is not kept: that it spoke keeps the Call from falling silent.
        this.#lastSaid = Date.now();
        return;
      case "session.input_transcript.delta": {
        const { delta, start_ms } = event as Extract<ProviderEvent, { delta: string }>;
        this.#lastSaid = Date.now();
        this.#heard.push({ words: delta, from: start_ms ?? Number.NEGATIVE_INFINITY });
        return;
      }
      case "session.delegation.created": {
        const { delegation, offset_ms } = event as Extract<ProviderEvent, { delegation: object }>;
        this.#lastSaid = Date.now();
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
    const asked = await this.#hooks.ask(words);
    // Refused, as at the cap: the voice says so, in its place.
    if ("refused" in asked) return this.#speak(handover, asked.refused);
    const { message } = asked;
    this.#handoverOf.set(message, handover);
    const early = this.#early.get(message);
    if (early) {
      this.#early.delete(message);
      this.answer(early);
    }
  }

  /**
   * A Message as the screen shows it. The Agent's answer to a Message sent in this Call, once its
   * Run has ended, is passed back under that Message's handover, split at sentences into parts the
   * provider takes; when the Run failed, the voice says what the Notice under the person's Message
   * says instead. A Message answering anything else, as one typed elsewhere meanwhile, is answered
   * in writing only.
   */
  answer(message: Message): void {
    if (this.#ended) return;
    if (message.from === "agent") {
      // A failed Run's answer, if it wrote one, is not spoken: its Notice is, as it comes.
      if (message.answers === null || message.run.ended === null) return;
      if (message.run.ended !== "failed") this.#reply(message.answers, message, message.words);
    } else if (message.notice !== null) {
      this.#reply(message.id, message, this.#hooks.failed(message.notice));
    }
  }

  /**
   * Speak these words under the handover the person's Message `asked` was sent for, or keep the
   * Message that brings them until `send_message` has said which Message it was.
   */
  #reply(asked: string, message: Message, words: string): void {
    const handover = this.#handoverOf.get(asked);
    if (handover === undefined) {
      this.#early.set(asked, message);
      return;
    }
    this.#handoverOf.delete(asked);
    this.#speak(handover, words);
  }

  /** Give the voice model the Agent's answer to speak, under the one handover it answers. */
  #speak(handover: string, words: string): void {
    if (!this.#unanswered.delete(handover)) return;
    this.#lastSaid = Date.now();
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

  /** The person hangs up. */
  hangUp(): Promise<void> {
    return this.#close("hung_up");
  }

  /**
   * End the Call from this Device, by the person's tap, on leaving Praxis or after two minutes of
   * silence: the Device ends the session at the provider and waits to hear it ended, then reports
   * the end, saying whether it heard.
   */
  async #close(ended: "hung_up" | "left" | "silence"): Promise<void> {
    if (this.#ended || this.#ending) return;
    let heard: (end: ProviderEnd) => void = () => {};
    const heardEnd = new Promise<ProviderEnd>((resolve) => {
      const timer = setTimeout(() => resolve(null), END_WAIT);
      heard = (end) => {
        clearTimeout(timer);
        resolve(end);
      };
    });
    this.#ending = heard;
    if (this.#channel.readyState === "open") this.#send({ type: "session.close" });
    else heard(null);
    await this.#finish(ended, await heardEnd);
  }

  /**
   * The object has ended the Call, at the cap, when another started or when it heard nothing from
   * this Device: it ended the session at the provider too, so this end only lets go.
   */
  #endedByObject(record: CallRecord): void {
    if (this.#ending) this.#ending(null);
    void this.#finish("lost", null, record);
  }

  /** The connection went without the provider saying the session ended. */
  #lose(): void {
    if (this.#ending) this.#ending(null);
    else void this.#finish("lost", null);
  }

  /**
   * End the Call on this Device, once: stop listening, let go of the microphone and the connection,
   * and report the end to the object, which ends the session itself when the Device did not hear it
   * end; unless the object ended it, and its record is given.
   */
  async #finish(ended: DeviceCallEnd, heard: ProviderEnd, given?: CallRecord): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    clearInterval(this.#signOfLife);
    document.removeEventListener("visibilitychange", this.#leaving);
    window.removeEventListener("pagehide", this.#leaving);
    window.removeEventListener("offline", this.#leaving);
    void this.#wakeLock?.release();
    this.#wakeLock = null;
    for (const track of this.#microphone.getTracks()) track.stop();
    this.#audio.srcObject = null;
    this.#connection.close();
    let record = given ?? null;
    if (given === undefined) {
      try {
        const result = await this.#callTool("end_call", {
          call: this.id,
          ended,
          provider_end: heard,
        });
        if (result.ok) record = result.value.call;
      } catch {
        // Not reached, as when the network is gone: the object ends the Call once it has heard no
        // sign of life for long enough.
      }
    }
    this.#hooks.ended({ ended, reason: heard?.reason ?? null, record });
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
