import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  type MessagesPage,
  SIGN_OF_LIFE_EVERY,
  SILENCE_ENDS_CALL,
  SPOKEN_PART,
  type Spend,
} from "@praxis/domain";
import {
  callContextTool,
  expect,
  test as journey,
  lastShown,
  makeContext,
  onPhone,
} from "./fixtures.ts";
import { holdTheCall } from "./one-call.ts";
import { fakeVoice } from "./voice-fake.ts";

// A Call (section 6, ADR 0021): the person speaks with the Agent, on a voice provider faked on the
// Device with scripted text and no sound (e2e/voice-fake.ts). There is one Call at a time for the
// Deployment, so each journey holds the Call for the whole of it (e2e/one-call.ts), as no other
// journey's start may end its own, and makes a Context of its own, as its Messages are counted.

const test = journey.extend<{ theCall: undefined }>({
  theCall: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads which fixtures it takes from it.
    async ({}, use, testInfo) => {
      const release = await holdTheCall(testInfo);
      try {
        await use(undefined);
      } finally {
        release();
      }
    },
    { auto: true },
  ],
});

/** A Context of this journey's own, shown, with its Conversation in view: on a phone, by its tab. */
async function inContext(page: Page, testInfo: TestInfo, name: string) {
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const context = await makeContext(page, {
    name: `${name} ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, context.id);
  await page.goto("/");
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
  }
  const conversation = page.getByRole("region", { name: "Conversation" });
  return { tag, id: context.id, name: `${name} ${tag}`, conversation };
}

/** The Call button in the Conversation's header, which starts a Call in the Context named. */
function callButton(conversation: Locator, name: string) {
  return conversation.getByRole("button", {
    name: `Start a Call with the Agent in ${name}`,
    exact: true,
  });
}

/** Start a Call from the Conversation, once the object has set it up. */
async function startCall(page: Page, conversation: Locator, name: string) {
  const started = page.waitForResponse(/\/tools\/start_call$/);
  await callButton(conversation, name).click();
  expect((await (await started).json()).ok).toBe(true);
  const controls = conversation.getByRole("region", { name: `Call in ${name}`, exact: true });
  await expect(controls).toBeVisible();
  return controls;
}

test("the person speaks in a Call, the Agent records it as their Entry and its answer is given to be spoken", async ({
  page,
}, testInfo) => {
  // The time so far is the Device's to count, so its clock is moved on.
  await page.clock.install();
  const voice = await fakeVoice(page);
  const { tag, id, name, conversation } = await inContext(page, testInfo, "Call");
  const controls = await startCall(page, conversation, name);
  // The header says so, with the time so far, and the Call button is gone from it.
  const header = conversation.getByRole("status").filter({ hasText: `On a Call in ${name}` });
  await expect(header).toBeVisible();
  const timer = conversation.getByRole("timer");
  await expect(timer).toHaveText(/^00:0\d$/);
  await page.clock.fastForward("01:05");
  await expect(timer).toHaveText(/^01:0\d$/);
  await expect(callButton(conversation, name)).toHaveCount(0);
  // The composer gives way to the Call's controls.
  await expect(
    conversation.getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true }),
  ).toHaveCount(0);

  const words = `Buy oat milk ${tag}`;
  const handover = await voice.say(`Record: ${words}`);

  // The person's Message is the text of what they said, marked as spoken, and the Agent's answer
  // is spoken.
  const list = conversation.getByRole("list", { name: "Messages" });
  const messages = list.getByTestId("message");
  await expect(messages.first()).toContainText(`Record: ${words}`);
  await expect(messages.first().getByText("Spoken", { exact: true })).toBeVisible();
  await expect(messages.last()).toContainText("Recorded.");
  await expect(messages.last().getByText("Spoken", { exact: true })).toHaveCount(0);
  await expect.poll(voice.spoken).toEqual([{ delegation_id: handover, content: "Recorded." }]);
  // Mute and End are where the composer was, under the Messages.
  const listBox = await list.boundingBox();
  const controlsBox = await controls.boundingBox();
  if (!listBox || !controlsBox)
    throw new Error("The Messages or the Call's controls are not shown.");
  expect(controlsBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);

  // The Entry holds what they said, as theirs, with no mark that it was spoken.
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toEqual([
    expect.objectContaining({ words, author: { kind: "person" }, through_conversation: true }),
  ]);
  expect(JSON.stringify(items)).not.toMatch(/spoken/i);

  // Mute turns the microphone off, and on again; the Call goes on.
  const mute = controls.getByRole("button", { name: "Mute", exact: true });
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  expect(await voice.microphoneOn()).toBe(false);
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  expect(await voice.microphoneOn()).toBe(true);

  // The tap ends it at the provider, and the Device says it heard the session close.
  const ended = page.waitForResponse(/\/tools\/end_call$/);
  await controls.getByRole("button", { name: "End Call", exact: true }).click();
  expect((await (await ended).json()).value.call).toMatchObject({
    ended: "hung_up",
    provider_reason: "close_requested",
    end_heard_by: "device",
  });
  await expect(
    conversation.getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true }),
  ).toBeVisible();
  // The header is the Conversation's again, with its Call button.
  await expect(header).toHaveCount(0);
  await expect(callButton(conversation, name)).toBeEnabled();
  // The Device sent the provider the Agent's answer and the end of the Call, and nothing else.
  expect((await voice.sent()).map(({ type }) => type)).toEqual([
    "session.commentary.append",
    "session.close",
  ]);
  expect(await voice.faults()).toEqual([]);
});

/**
 * Have the screen read the Conversation as `list_messages` would answer with these: the journeys'
 * Worker has a voice key and an Agent for every Context, so one with neither is told it has none.
 * The seam tests reach `no_key` for real.
 */
async function messagesSay(page: Page, say: Partial<Pick<MessagesPage, "agent" | "voice">>) {
  await page.route(/\/tools\/list_messages$/, async (route) => {
    const answer = await route.fetch();
    const { value } = (await answer.json()) as { value: MessagesPage };
    await route.fulfill({ response: answer, json: { ok: true, value: { ...value, ...say } } });
  });
}

test("without a voice key, or without an Agent, the Conversation offers no Call", async ({
  page,
}, testInfo) => {
  await messagesSay(page, { voice: "no_key" });
  const { name, conversation } = await inContext(page, testInfo, "No voice");
  // Read: the composer shows once the Conversation says there is an Agent.
  await expect(
    conversation.getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true }),
  ).toBeVisible();
  await expect(callButton(conversation, name)).toHaveCount(0);

  await page.unrouteAll();
  await messagesSay(page, { agent: "no_key" });
  await page.reload();
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
  }
  await expect(conversation.getByText(/^There is no Agent here/)).toBeVisible();
  await expect(callButton(conversation, name)).toHaveCount(0);
});

test("with the network cut, the Call button is shown but cannot be pressed, and says Calls need the network", async ({
  page,
}, testInfo) => {
  const { name, conversation } = await inContext(page, testInfo, "Offline");
  const button = callButton(conversation, name);
  await expect(button).toBeEnabled();

  await page.context().setOffline(true);

  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription("Calls need the network.");
});

test("at the cap, the Call button is shown but cannot be pressed, and says the cap stops it", async ({
  page,
}, testInfo) => {
  // The shared Deployment is never at the cap, so this screen is told it is, as e2e/spend.spec.ts
  // has it: reaching it for real would stop every other journey's Runs.
  await page.route(/\/get_spend$/, async (route) => {
    const answer = await route.fetch();
    const { value } = (await answer.json()) as { value: Spend };
    await route.fulfill({
      response: answer,
      json: { ok: true, value: { ...value, spent: value.cap, notice: "cap_reached" } },
    });
  });
  const { name, conversation } = await inContext(page, testInfo, "Capped");
  await expect(conversation.getByText(/This month's spend has reached its cap/)).toBeVisible();

  const button = callButton(conversation, name);
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription(
    "No Call can start: this month's spend reached its cap.",
  );
});

test("what the voice model answers by itself is not kept, and the next Message holds everything said since", async ({
  page,
}, testInfo) => {
  const voice = await fakeVoice(page);
  const { tag, name, conversation } = await inContext(page, testInfo, "Small talk");
  await startCall(page, conversation, name);

  await voice.smallTalk(`Hello there ${tag}.`);
  await voice.say(`What is due today ${tag}?`);

  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages).toHaveCount(2);
  await expect(messages.first()).toContainText(`Hello there ${tag}. What is due today ${tag}?`);

  // Talking over the Agent stops nothing: no event goes to the provider, and its Message stays.
  await expect.poll(async () => (await voice.spoken()).length).toBe(1);
  await voice.smallTalk("Wait, stop");
  await expect(messages).toHaveCount(2);
  await expect(messages.last()).toContainText("Noted.");
  expect((await voice.sent()).map(({ type }) => type)).toEqual(["session.commentary.append"]);
  expect(await voice.faults()).toEqual([]);
});

test("a long answer is given to be spoken in parts the provider takes, split at its sentences", async ({
  page,
}, testInfo) => {
  const voice = await fakeVoice(page);
  const { tag, name, conversation } = await inContext(page, testInfo, "Long answer");
  await startCall(page, conversation, name);
  const sentences = Array.from(
    { length: 40 },
    (_, at) => `Task ${at + 1} of ${tag} is due on Friday and waits on the landlord.`,
  );

  await voice.say(`Say: ${sentences.join(" ")}`);

  await expect.poll(async () => (await voice.spoken()).length).toBeGreaterThan(1);
  const parts = (await voice.spoken()).map(({ content }) => content);
  for (const part of parts) {
    expect(part.length).toBeLessThanOrEqual(SPOKEN_PART);
    expect(part).toMatch(/\.$/);
  }
  expect(parts.join(" ")).toBe(sentences.join(" "));
  expect(await voice.faults()).toEqual([]);
});

test("the provider ending a Call by its safety filter ends it with a Notice, which is not a Message", async ({
  page,
}, testInfo) => {
  const voice = await fakeVoice(page);
  const { name, conversation } = await inContext(page, testInfo, "Filtered");
  await startCall(page, conversation, name);

  const ended = page.waitForResponse(/\/tools\/end_call$/);
  await voice.end("content");

  expect((await (await ended).json()).value.call).toMatchObject({
    ended: "provider_ended",
    provider_reason: "content",
    end_heard_by: "device",
  });
  await expect(
    conversation.getByRole("status").filter({ hasText: "safety filter ended it" }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("list", { name: "Messages" }).getByTestId("message"),
  ).toHaveCount(0);
  expect(await voice.sent()).toEqual([]);
});

test("a connection lost ends the Call with a Notice, and the object closes the session itself", async ({
  page,
}, testInfo) => {
  const voice = await fakeVoice(page);
  const { name, conversation } = await inContext(page, testInfo, "Lost");
  await startCall(page, conversation, name);

  const ended = page.waitForResponse(/\/tools\/end_call$/);
  await voice.drop();

  expect((await (await ended).json()).value.call).toMatchObject({
    ended: "lost",
    provider_reason: "close_requested",
    end_heard_by: "object",
  });
  await expect(
    conversation
      .getByRole("status")
      .filter({ hasText: "connection to the voice provider was lost" }),
  ).toBeVisible();
  await expect(callButton(conversation, name)).toBeEnabled();
});

test("starting a Call elsewhere ends this one: the object ends it at the provider, and the Device's sign of life finds it ended", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const voice = await fakeVoice(page);
  const { tag, name, conversation } = await inContext(page, testInfo, "Replaced");
  await startCall(page, conversation, name);

  // Another Call, in another Context, as another Device starts one.
  const other = await makeContext(page, {
    name: `Elsewhere ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  const elsewhere = await callContextTool(page, other.id, "start_call", {
    offer: "v=0\r\ns=elsewhere\r\n",
  });
  const alive = page.waitForResponse(/\/tools\/note_call_alive$/);
  await page.clock.fastForward(SIGN_OF_LIFE_EVERY);

  expect((await (await alive).json()).value.call).toMatchObject({
    ended: "replaced",
    end_heard_by: "object",
  });
  await expect(
    conversation.getByRole("status").filter({ hasText: "another Call was started" }),
  ).toBeVisible();
  await expect(callButton(conversation, name)).toBeEnabled();
  // The object ended the session itself: the Device sent the provider nothing.
  expect(await voice.sent()).toEqual([]);
  await callContextTool(page, other.id, "end_call", {
    call: elsewhere.call.id,
    ended: "hung_up",
    provider_end: null,
  });
});

test("about two minutes in which nothing is said end the Call, with a Notice", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const voice = await fakeVoice(page);
  const { tag, name, conversation } = await inContext(page, testInfo, "Silence");
  await startCall(page, conversation, name);
  await voice.say(`What is due ${tag}?`);
  await expect.poll(async () => (await voice.spoken()).length).toBe(1);

  const ended = page.waitForResponse(/\/tools\/end_call$/);
  await page.clock.fastForward(SILENCE_ENDS_CALL + SIGN_OF_LIFE_EVERY);

  expect((await (await ended).json()).value.call).toMatchObject({
    ended: "silence",
    provider_reason: "close_requested",
    end_heard_by: "device",
  });
  await expect(
    conversation.getByRole("status").filter({ hasText: "two minutes in which nothing was said" }),
  ).toBeVisible();
  expect((await voice.sent()).map(({ type }) => type)).toEqual([
    "session.commentary.append",
    "session.close",
  ]);
});

test("leaving Praxis ends the Call at the provider", async ({ page }, testInfo) => {
  const voice = await fakeVoice(page);
  const { name, conversation } = await inContext(page, testInfo, "Left");
  await startCall(page, conversation, name);

  const ended = page.waitForResponse(/\/tools\/end_call$/);
  // The tab hidden, as when the screen is locked or another app is opened.
  await voice.hide(true);

  expect((await (await ended).json()).value.call).toMatchObject({
    ended: "left",
    end_heard_by: "device",
  });
  expect((await voice.sent()).map(({ type }) => type)).toEqual(["session.close"]);
  await voice.hide(false);
  await expect(
    conversation.getByRole("status").filter({ hasText: "ended when Praxis was left" }),
  ).toBeVisible();
});

test("when a Run fails in a Call, the voice says so and the usual Notice sits under the Message", async ({
  page,
}, testInfo) => {
  const voice = await fakeVoice(page);
  const { tag, name, conversation } = await inContext(page, testInfo, "Failing");
  await startCall(page, conversation, name);

  const handover = await voice.say(`Unreachable once: ${tag}`);

  const said = "The model could not be reached, so the Agent did not answer. Your Message is kept.";
  await expect.poll(voice.spoken).toEqual([{ delegation_id: handover, content: said }]);
  const message = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(message).toHaveCount(1);
  await expect(message.getByRole("status")).toContainText("could not be reached");
  expect(await voice.faults()).toEqual([]);
});

test("a Message typed elsewhere during a Call is answered in writing only", async ({
  page,
}, testInfo) => {
  const voice = await fakeVoice(page);
  const { tag, id, name, conversation } = await inContext(page, testInfo, "Typed");
  await startCall(page, conversation, name);

  // Typed on another Device in the same Context, as the composer here gives way to the Call.
  await callContextTool(page, id, "send_message", { words: `Say: Written only ${tag}.` });

  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages.last()).toContainText(`Written only ${tag}.`);
  await voice.say(`What is due ${tag}?`);
  await expect.poll(async () => (await voice.spoken()).length).toBe(1);
  expect((await voice.spoken()).map(({ content }) => content)).toEqual(["Noted."]);
});
