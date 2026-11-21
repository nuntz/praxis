import { describe, expect, test } from "vitest";
import { endOnSideChannel } from "../src/voice.ts";

// The voice provider's side channel, as the real adapter ends a session on it (ADR 0021): a
// socket pair stands in for the provider's, which sends every frame of sound both ways to whatever
// attaches, the few seconds replayed on attaching included, until the session has closed.

/** A frame of the sound the side channel copies, as base64 PCM. */
function sound(direction: "input" | "output"): string {
  const audio = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(480))));
  return direction === "input"
    ? JSON.stringify({ type: "session.input_audio.append", audio })
    : JSON.stringify({ type: "session.output_audio.delta", delta: audio, start_ms: 0, end_ms: 10 });
}

/**
 * A provider's side channel that, once attached, replays sound, then on `session.close` sends
 * more sound and what `then` gives, and keeps what the object sent it.
 */
function provider(then: (socket: WebSocket) => void) {
  const sent: string[] = [];
  const attach = async () => {
    const { 0: object, 1: side } = new WebSocketPair();
    side.accept();
    object.accept();
    side.addEventListener("message", (event) => {
      sent.push(String(event.data));
      side.send(sound("input"));
      side.send(sound("output"));
      then(side);
    });
    // The replay of the seconds before attaching.
    side.send(sound("input"));
    side.send(sound("output"));
    return object;
  };
  return { attach, sent };
}

describe("the voice provider's side channel", () => {
  test("ends the session, drops the sound it is sent, and keeps the reason the provider gives", async () => {
    const { attach, sent } = provider((side) =>
      side.send(
        JSON.stringify({
          type: "session.closed",
          event_id: "evt_1",
          reason: "close_requested",
          usage: { seconds: 61 },
        }),
      ),
    );

    const reason = await endOnSideChannel(attach, "live_1", "voice-key");

    expect(sent).toEqual([JSON.stringify({ type: "session.close" })]);
    expect(reason).toEqual({ reason: "close_requested" });
  });

  test("a provider that closes the socket without saying the session ended is not heard to end it", async () => {
    const { attach } = provider((side) => side.close(1000, "Gone"));

    expect(await endOnSideChannel(attach, "live_1", "voice-key")).toBeNull();
  });

  test("a provider that never says the session ended is let go of in time, not heard", async () => {
    const { attach } = provider(() => {});

    expect(await endOnSideChannel(attach, "live_1", "voice-key", 50)).toBeNull();
  });

  test("a session the object cannot attach to, as one gone already, is not heard to end", async () => {
    expect(await endOnSideChannel(async () => null, "live_1", "voice-key")).toBeNull();
  });
});
