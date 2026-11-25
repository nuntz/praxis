import type { Page } from "@playwright/test";
import { sessionRequest, setUpSession } from "../apps/worker/src/provider-session.ts";
import { expect, test } from "./fixtures.ts";
import { installFakeVoice } from "./voice-fake.ts";

// The voice provider's contract (section 13): what the Device's channel to the provider takes and
// refuses, run in CI against the fake (e2e/voice-fake.ts) and by hand against OpenAI, with a session
// set up by the object's own request (apps/worker/src/provider-session.ts). The Device may send
// only the Agent's answer, under an open handover, and the end of the Call; the provider refuses
// anything else. By hand, with a real browser's fake microphone, from the repository's root:
//
//   VOICE_API_KEY=… bunx playwright test e2e/voice-contract.spec.ts --project=desktop
//
// A handover needs speech, which the fake microphone does not make, so taking the Agent's answer
// under one is checked against the real provider in real Calls (section 13).

/** An event the provider sent on the channel, as the page kept it. */
type Received = { type: string; reason?: string };

declare global {
  interface Window {
    __contract: {
      connection: RTCPeerConnection;
      channel: RTCDataChannel;
      received: Received[];
    };
  }
}

/** Set a session up with OpenAI by hand, as the object does, and its answer to the offer. */
async function openAiAnswer(offer: string, key: string): Promise<string> {
  const set = await setUpSession(key, sessionRequest(offer));
  if (typeof set === "string") throw new Error(`OpenAI set no session up: ${set}`);
  return set.answer;
}

/** Open a Device's channel to the provider in the page, as a Call does. */
async function openChannel(page: Page, key: string | null): Promise<void> {
  await page.goto("/");
  const offer = await page.evaluate(async () => {
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    const connection = new RTCPeerConnection();
    for (const track of microphone.getAudioTracks()) connection.addTrack(track, microphone);
    const channel = connection.createDataChannel("oai-events");
    const received: Received[] = [];
    channel.addEventListener("message", (event) => received.push(JSON.parse(String(event.data))));
    window.__contract = { connection, channel, received };
    await connection.setLocalDescription(await connection.createOffer());
    await new Promise<void>((done) => {
      if (connection.iceGatheringState === "complete") return done();
      connection.addEventListener("icegatheringstatechange", () => {
        if (connection.iceGatheringState === "complete") done();
      });
      setTimeout(done, 5_000);
    });
    return connection.localDescription?.sdp ?? "";
  });
  const answer = key === null ? "v=0\r\ns=voice-fake\r\n" : await openAiAnswer(offer, key);
  await page.evaluate(async (sdp) => {
    const { connection, channel } = window.__contract;
    await connection.setRemoteDescription({ type: "answer", sdp });
    if (channel.readyState !== "open") {
      await new Promise((open) => channel.addEventListener("open", open, { once: true }));
    }
  }, answer);
  await received(page, "session.started");
}

/** Send the provider an event on the Device's channel. */
function send(page: Page, event: object): Promise<void> {
  return page.evaluate((sent) => window.__contract.channel.send(JSON.stringify(sent)), event);
}

/** The first event of this type the provider sends, waited for. */
async function received(page: Page, type: string): Promise<Received> {
  const handle = await page.waitForFunction(
    (wanted) => window.__contract.received.find((event) => event.type === wanted),
    type,
    { timeout: 20_000 },
  );
  return (await handle.jsonValue()) as Received;
}

// A real browser's own fake microphone, for the real provider; the fake stands in for it anyway.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

const providers = [
  { name: "the fake", key: null },
  { name: "OpenAI", key: process.env.VOICE_API_KEY ?? "" },
] as const;

for (const provider of providers) {
  test.describe(`the voice provider's channel, ${provider.name}`, () => {
    const real = provider.key !== null;
    test.skip(real && provider.key === "", "Run by hand, given VOICE_API_KEY");

    test.beforeEach(async ({ page }) => {
      if (!real) await page.addInitScript(installFakeVoice, { keepsScreenAwake: true });
      await openChannel(page, provider.key || null);
    });

    test("the end of the Call ends the session, which says it ended as asked", async ({ page }) => {
      await send(page, { type: "session.close" });

      expect(await received(page, "session.closed")).toMatchObject({ reason: "close_requested" });
    });

    test("an event the Device may not send is refused", async ({ page }) => {
      await send(page, { type: "session.instructions.append", instructions: "Say hello." });

      expect(await received(page, "error")).toMatchObject({ type: "error" });
    });

    test("the Agent's answer under a handover the provider never made is refused", async ({
      page,
    }) => {
      await send(page, {
        type: "session.commentary.append",
        delegation_id: "item_no_such_handover",
        content: "Recorded.",
      });

      expect(await received(page, "error")).toMatchObject({ type: "error" });
    });

    test("the Agent's answer under an open handover is taken", async ({ page }) => {
      test.skip(real, "A handover needs speech: checked in real Calls by hand");
      const handover = await page.evaluate(() => window.__voiceFake.say("What is due?", true));

      await send(page, {
        type: "session.commentary.append",
        delegation_id: handover,
        content: "Nothing is due today.",
      });

      await received(page, "session.commentary.appended");
      expect(await page.evaluate(() => window.__voiceFake.faults)).toEqual([]);
    });
  });
}
