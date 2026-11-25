import type { Page } from "@playwright/test";

// The voice provider is one of the faked things (section 13). This is its end on the Device: it
// stands in for the browser's WebRTC and microphone, for whether the page is shown, which a
// journey cannot hide, and for the Screen Wake Lock, which a headless browser does not grant, so a Call carries scripted text and
// handovers and no sound, as the provider's channel would. Its end at the Context's object is
// apps/worker/test/voice-fake.ts, which the journeys' Worker sets every Call up at. It holds the
// Device to the contract (e2e/voice-contract.spec.ts): an event the Device may not send, or the
// Agent's answer under no handover the provider made, is refused as the provider refuses it, and
// kept as a fault the journey fails on.

/** What a journey reads of the fake and does through it, in the page. */
export type FakeVoice = {
  /** Whether a session has been set up, its answer taken. */
  connected: boolean;
  /**
   * The person says these words: their text comes in fragments, and then, unless the voice model
   * answers them itself, as small talk, a handover. The handover's id.
   */
  say(words: string, handOver: boolean): string | null;
  /** The provider ends the session itself, with its reason. */
  end(reason: string): void;
  /** The connection to the provider is lost, with no word of the session closing. */
  drop(): void;
  /** Everything the Device sent the provider, in order. */
  sent: { type: string; [field: string]: unknown }[];
  /** The Agent's answer as given to be spoken: each part, under its handover. */
  spoken: { delegation_id: string; content: string }[];
  /** What the Device sent that the provider refuses. */
  faults: string[];
  /** Whether the Device's microphone track is on. */
  microphoneOn(): boolean;
  /** The person leaves Praxis: the tab hidden, as when the screen is locked, or shown again. */
  hide(hidden: boolean): void;
  /** Whether the Device is kept from locking its screen by itself. */
  awake(): boolean;
  /** The Device releases every wake lock on its screen, as iOS may while the page is shown. */
  releaseScreen(): void;
  /** The next request for a wake lock goes unanswered until `answerScreen`. */
  delayScreen(): void;
  /** Answer the request `delayScreen` kept waiting. */
  answerScreen(): void;
};

declare global {
  interface Window {
    __voiceFake: FakeVoice;
  }
}

/**
 * Put the fake in the page's place of WebRTC and the microphone, before the page loads, and of the
 * Screen Wake Lock unless the Device has none. Runs in the page, so it holds everything it uses.
 */
export function installFakeVoice({ keepsScreenAwake }: { keepsScreenAwake: boolean }): void {
  const allowed = ["session.commentary.append", "session.close"];
  let clock = 0;
  let channel: FakeChannel | null = null;
  let connection: FakePeerConnection | null = null;
  const handovers = new Set<string>();
  const track = { kind: "audio", enabled: true, stopped: false, stop() {} };
  track.stop = () => {
    track.stopped = true;
  };

  class FakeChannel extends EventTarget {
    readyState: RTCDataChannelState = "connecting";
    readonly label: string;
    constructor(label: string) {
      super();
      this.label = label;
    }
    /** The provider sends the Device an event. */
    emit(event: object): void {
      if (this.readyState !== "open") return;
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
    }
    open(): void {
      this.readyState = "open";
      this.dispatchEvent(new Event("open"));
    }
    send(data: string): void {
      if (this.readyState !== "open") throw new Error("The channel is not open");
      const event = JSON.parse(data) as {
        type: string;
        delegation_id?: unknown;
        content?: unknown;
      };
      fake.sent.push(event);
      const refuse = (why: string) => {
        fake.faults.push(why);
        this.emit({
          type: "error",
          event_id: `event_${++clock}`,
          error: { type: "invalid_request_error", code: null, message: why },
        });
      };
      const delegation = event.delegation_id;
      if (!allowed.includes(event.type)) {
        refuse(`${event.type} is not allowed`);
      } else if (event.type === "session.close") {
        this.emit({
          type: "session.closed",
          event_id: `event_${++clock}`,
          reason: "close_requested",
        });
        this.close();
      } else if (typeof delegation !== "string" || !handovers.has(delegation)) {
        refuse(`commentary under no handover: ${String(delegation)}`);
      } else if (typeof event.content !== "string") {
        refuse("commentary with no content");
      } else {
        fake.spoken.push({ delegation_id: delegation, content: event.content });
        this.emit({ type: "session.commentary.appended", start_ms: clock, end_ms: clock });
      }
    }
    close(): void {
      if (this.readyState === "closed") return;
      this.readyState = "closed";
      this.dispatchEvent(new Event("close"));
    }
  }

  class FakePeerConnection extends EventTarget {
    connectionState: RTCPeerConnectionState = "new";
    iceGatheringState: RTCIceGatheringState = "complete";
    localDescription: { type: string; sdp: string } | null = null;
    constructor() {
      super();
      connection = this;
    }
    addTrack(): void {}
    createDataChannel(label: string): FakeChannel {
      channel = new FakeChannel(label);
      return channel;
    }
    async createOffer() {
      return { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=device-fake\r\n" };
    }
    async setLocalDescription(description: { type: string; sdp: string }) {
      this.localDescription = description;
    }
    async setRemoteDescription() {
      this.connectionState = "connected";
      fake.connected = true;
      setTimeout(() => {
        channel?.open();
        channel?.emit({
          type: "session.started",
          event_id: `event_${++clock}`,
          session: { id: "live_fake", model: "gpt-live-1.1", status: "active" },
        });
      }, 0);
    }
    close(): void {
      this.connectionState = "closed";
      channel?.close();
    }
  }

  const fake: FakeVoice = {
    connected: false,
    sent: [],
    spoken: [],
    faults: [],
    say(words, handOver) {
      // Spoken to before the Device has a channel, the fake fails as a fault of its own.
      if (channel?.readyState !== "open")
        throw new Error("The fake was spoken to before its channel opened");
      const fragments = words.match(/\S+\s*/g) ?? [];
      for (const fragment of fragments) {
        const start = ++clock;
        channel?.emit({
          type: "session.input_transcript.delta",
          event_id: `event_${start}`,
          delta: fragment,
          start_ms: start,
          end_ms: start,
        });
      }
      if (!handOver) return null;
      const id = `item_${crypto.randomUUID()}`;
      handovers.add(id);
      channel?.emit({
        type: "session.delegation.created",
        event_id: `event_${++clock}`,
        offset_ms: clock,
        delegation: { id, type: "delegation", target: "client" },
      });
      return id;
    },
    end(reason) {
      channel?.emit({ type: "session.closed", event_id: `event_${++clock}`, reason });
      channel?.close();
    },
    drop() {
      if (connection) connection.connectionState = "failed";
      connection?.dispatchEvent(new Event("connectionstatechange"));
      channel?.close();
    },
    microphoneOn: () => track.enabled && !track.stopped,
    hide: () => {},
    awake: () => wakeLocks.size > 0,
    releaseScreen: () => {
      for (const wakeLock of [...wakeLocks]) wakeLock.letGo();
    },
    delayScreen: () => {
      delayed = new Promise((answer) => {
        fake.answerScreen = answer;
      });
    },
    answerScreen: () => {},
  };

  // The Screen Wake Lock: one is granted only while the page is shown, and released when it is
  // hidden, as the browser does.
  const wakeLocks = new Set<FakeWakeLock>();
  let delayed: Promise<void> | null = null;
  class FakeWakeLock extends EventTarget {
    readonly type = "screen";
    released = false;
    async release(): Promise<void> {
      this.letGo();
    }
    letGo(): void {
      if (this.released) return;
      this.released = true;
      wakeLocks.delete(this);
      this.dispatchEvent(new Event("release"));
    }
  }
  const wakeLock = {
    request: async (type: string) => {
      if (delayed) {
        const answered = delayed;
        delayed = null;
        await answered;
      }
      if (type !== "screen" || hidden) throw new DOMException("Not shown", "NotAllowedError");
      const granted = new FakeWakeLock();
      wakeLocks.add(granted);
      return granted;
    },
  };
  Object.defineProperty(navigator, "wakeLock", { value: keepsScreenAwake ? wakeLock : undefined });

  let hidden = false;
  Object.defineProperty(document, "visibilityState", {
    get: () => (hidden ? "hidden" : "visible"),
  });
  Object.defineProperty(document, "hidden", { get: () => hidden });
  fake.hide = (to) => {
    hidden = to;
    if (hidden) fake.releaseScreen();
    document.dispatchEvent(new Event("visibilitychange"));
  };

  window.__voiceFake = fake;
  Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection });
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => ({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      }),
    },
  });
  // No sound plays: the fake carries none.
  Object.defineProperty(window, "MediaStream", { value: class {} });
}

/**
 * The fake in this page, put in place before it loads, and a journey's way to it: on a Device that
 * can keep its screen awake, unless told otherwise.
 */
export async function fakeVoice(page: Page, { keepsScreenAwake = true } = {}) {
  await page.addInitScript(installFakeVoice, { keepsScreenAwake });
  return {
    /** The person speaks, and the voice model hands it over: the handover's id. */
    say: (words: string) =>
      page.evaluate((said) => window.__voiceFake.say(said, true) ?? "", words),
    /** The person makes small talk, which the voice model answers itself. */
    smallTalk: (words: string) =>
      page.evaluate((said) => void window.__voiceFake.say(said, false), words),
    end: (reason: string) => page.evaluate((why) => window.__voiceFake.end(why), reason),
    drop: () => page.evaluate(() => window.__voiceFake.drop()),
    sent: () => page.evaluate(() => window.__voiceFake.sent),
    spoken: () => page.evaluate(() => window.__voiceFake.spoken),
    faults: () => page.evaluate(() => window.__voiceFake.faults),
    microphoneOn: () => page.evaluate(() => window.__voiceFake.microphoneOn()),
    hide: (hidden: boolean) => page.evaluate((to) => window.__voiceFake.hide(to), hidden),
    awake: () => page.evaluate(() => window.__voiceFake.awake()),
    releaseScreen: () => page.evaluate(() => window.__voiceFake.releaseScreen()),
    delayScreen: () => page.evaluate(() => window.__voiceFake.delayScreen()),
    answerScreen: () => page.evaluate(() => window.__voiceFake.answerScreen()),
  };
}
