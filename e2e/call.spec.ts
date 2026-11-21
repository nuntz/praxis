import type { Page, TestInfo } from "@playwright/test";
import { SPOKEN_PART } from "@praxis/domain";
import { callContextTool, expect, lastShown, makeContext, onPhone, test } from "./fixtures.ts";
import { fakeVoice } from "./voice-fake.ts";

// A Call (section 6, ADR 0021): the person speaks with the Agent, on a voice provider faked on the
// Device with scripted text and no sound (e2e/voice-fake.ts). Each journey makes a Context of its
// own, since starting a Call ends any other going in its Context.

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

/** Start a Call from the Conversation, once the object has set it up. */
async function startCall(page: Page, conversation: ReturnType<Page["getByRole"]>, name: string) {
  const started = page.waitForResponse(/\/tools\/start_call$/);
  await conversation.getByRole("button", { name: "Start a Call", exact: true }).click();
  expect((await (await started).json()).ok).toBe(true);
  const controls = conversation.getByRole("region", { name: `Call in ${name}`, exact: true });
  await expect(controls).toBeVisible();
  return controls;
}

test("the person speaks in a Call, the Agent records it as their Entry and its answer is given to be spoken", async ({
  page,
}, testInfo) => {
  const voice = await fakeVoice(page);
  const { tag, id, name, conversation } = await inContext(page, testInfo, "Call");
  const controls = await startCall(page, conversation, name);
  // The composer gives way to the Call's controls.
  await expect(
    conversation.getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true }),
  ).toHaveCount(0);

  const words = `Buy oat milk ${tag}`;
  const handover = await voice.say(`Record: ${words}`);

  // The person's Message is the text of what they said, and the Agent's answer is spoken.
  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages.first()).toContainText(`Record: ${words}`);
  await expect(messages.last()).toContainText("Recorded.");
  await expect.poll(voice.spoken).toEqual([{ delegation_id: handover, content: "Recorded." }]);

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
  await controls.getByRole("button", { name: "End the Call", exact: true }).click();
  expect((await (await ended).json()).value.call).toMatchObject({
    ended: "hung_up",
    provider_reason: "close_requested",
    end_heard_by: "device",
  });
  await expect(
    conversation.getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true }),
  ).toBeVisible();
  // The Device sent the provider the Agent's answer and the end of the Call, and nothing else.
  expect((await voice.sent()).map(({ type }) => type)).toEqual([
    "session.commentary.append",
    "session.close",
  ]);
  expect(await voice.faults()).toEqual([]);
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
  await expect(
    conversation.getByRole("button", { name: "Start a Call", exact: true }),
  ).toBeVisible();
});
