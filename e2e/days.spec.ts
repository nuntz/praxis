import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  enterSearch,
  expect,
  lastShown,
  makeContext,
  openJournal,
  showTab,
  test,
} from "./fixtures.ts";

// The Journal and the Conversation are parted into days, "Today", "Yesterday", then the weekday and
// the date, reckoned in the Context's time zone (section 8.1). Each journey makes a Context of its
// own, in a zone where now falls on another day than on the Device, so a day reckoned in the
// Device's zone shows under another caption.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The day an instant falls on in a zone, `YYYY-MM-DD`. */
function dayIn(at: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
}

/** The Device's zone, which the project gives it. */
function deviceZone(testInfo: TestInfo): string {
  return testInfo.project.use.timezoneId as string;
}

/**
 * A zone where the next few minutes fall on another day than on the Device. Neither has summer
 * time, so a day there is 24 hours. Kiritimati is 14 hours ahead of UTC, Pago Pago 11 behind.
 */
function zoneApartFrom(device: string, now: number): string {
  const zone = ["Pacific/Pago_Pago", "Pacific/Kiritimati"].find((each) =>
    [now, now + 10 * 60 * 1000].every((at) => dayIn(at, each) !== dayIn(at, device)),
  );
  if (zone === undefined) throw new Error(`No zone on another day than ${device} now`);
  return zone;
}

/**
 * An instant on this day in the Context's zone that falls on another day in the Device's, so it is
 * an Entry whose day the two zones disagree on.
 */
function onDayApart(day: string, zone: string, device: string, now: number): number {
  for (let at = now - 5 * DAY; at < now; at += 15 * 60 * 1000) {
    if (dayIn(at, zone) === day && dayIn(at, device) !== day) return at;
  }
  throw new Error(`No instant on ${day} in ${zone} that is another day in ${device}`);
}

/** How the Device's locale writes a day older than yesterday: its weekday and its date. */
async function dated(page: Page, day: string): Promise<string> {
  const locale = await page.evaluate(() => navigator.language);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(`${day}T12:00:00Z`));
}

/** How the Device's locale writes an instant in a zone, in a style such as the time of day alone. */
function writtenIn(page: Page, at: number, zone: string, style: Intl.DateTimeFormatOptions) {
  return page.evaluate(
    ([instant, options]) => new Intl.DateTimeFormat(undefined, options).format(instant),
    [at, { ...style, timeZone: zone }] as const,
  );
}

/** The day caption something falls under: the last one above it in its list. */
async function captionOver(captions: Locator, item: Locator): Promise<string> {
  const top = (await item.boundingBox())?.y;
  if (top === undefined) throw new Error("Not shown, so it falls under no day");
  const labels = await captions.allTextContents();
  let over: string | undefined;
  for (const [at, caption] of (await captions.all()).entries()) {
    const box = await caption.boundingBox();
    if (box !== null && box.y < top) over = labels[at];
  }
  if (over === undefined) throw new Error("Falls under no day");
  return over;
}

test("the Journal is parted into days in the Context's time zone, an Entry under its own day there", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const device = deviceZone(testInfo);
  const now = Date.now();
  const zone = zoneApartFrom(device, now);
  const context = await makeContext(page, { name: `Days ${tag}`, time_zone: zone, accent: "moss" });
  const today = dayIn(now, zone);
  const yesterday = dayIn(now - DAY, zone);
  const older = dayIn(now - 3 * DAY, zone);

  // Each on a day the Device's zone would put it on another: made then, by the person's hand.
  const made = {
    older: onDayApart(older, zone, device, now),
    yesterday: onDayApart(yesterday, zone, device, now),
  };
  for (const [which, at] of Object.entries(made)) {
    await callContextTool(page, context.id, "record_entry", {
      words: `${which} ${tag}`,
      made_at: new Date(at).toISOString(),
    });
  }
  // Another on the same day, which starts no day of its own. The older one is the first instant of
  // its day found, so this one, a few minutes on, is on that day too.
  await callContextTool(page, context.id, "record_entry", {
    words: `later that day ${tag}`,
    made_at: new Date(made.older + 5 * 60 * 1000).toISOString(),
  });
  await lastShown(page, context.id);
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const entries = journal.getByTestId("entry");
  await expect(entries).toHaveCount(3);

  // The person records one now, which falls under today.
  await composer.fill(`today ${tag}`);
  await journal.getByRole("button", { name: "Record", exact: true }).click();
  await expect(entries).toHaveCount(4);

  // A day is a caption a screen reader reads, once for each day, oldest first.
  const days = journal.getByRole("list", { name: "Entries" }).getByRole("heading");
  const olderDay = await dated(page, older);
  await expect(days).toHaveText([olderDay, "Yesterday", "Today"]);
  expect(today).not.toBe(dayIn(now, device));

  const under = (words: string) => captionOver(days, entries.filter({ hasText: words }));
  expect(await under(`later that day ${tag}`)).toBe(olderDay);
  expect(await under(`older ${tag}`)).toBe(olderDay);
  expect(await under(`yesterday ${tag}`)).toBe("Yesterday");
  expect(await under(`today ${tag}`)).toBe("Today");

  // Under its day, an Entry says its time of day alone, in the Context's zone, as the Device's
  // locale writes it; what a search finds is parted into no days, so it says its day too, as the
  // Journal reckons it.
  await expect(entries.filter({ hasText: `older ${tag}` }).getByRole("time")).toHaveText(
    await writtenIn(page, made.older, zone, { timeStyle: "short" }),
  );
  await (await enterSearch(page)).fill(`yesterday ${tag}`);
  const found = journal.getByRole("region", { name: "Found" }).getByTestId("search-hit");
  await expect(found.filter({ hasText: `yesterday ${tag}` }).getByRole("time")).toHaveText(
    `Yesterday · ${await writtenIn(page, made.yesterday, zone, { timeStyle: "short" })}`,
  );
});

test("the Conversation is parted into days in the Context's time zone, as the Journal is", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const device = deviceZone(testInfo);
  const now = Date.now();
  const zone = zoneApartFrom(device, now);
  const name = `Talk days ${tag}`;
  const context = await makeContext(page, { name, time_zone: zone, accent: "rust" });
  await callContextTool(page, context.id, "send_message", { words: `Say: First ${tag}` });
  await lastShown(page, context.id);

  async function openConversation() {
    await showTab(page, testInfo, "Agent");
    const conversation = page.getByRole("region", { name: "Conversation" });
    const list = conversation.getByRole("list", { name: "Messages" });
    return { conversation, messages: list.getByTestId("message"), days: list.getByRole("heading") };
  }

  await page.goto("/");
  const { conversation, messages, days } = await openConversation();
  await expect(messages).toHaveCount(2);
  await expect(days).toHaveText(["Today"]);

  // The person's own Message, sent now, falls under the same day.
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: Second ${tag}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  await expect(messages).toHaveCount(4);
  await expect(days).toHaveText(["Today"]);
  expect(await captionOver(days, messages.last())).toBe("Today");

  // A day on, by the Device's clock, they were yesterday; three days on, they were on their day in
  // the Context's zone, which is another day in the Device's.
  await page.clock.setFixedTime(now + DAY);
  await page.reload();
  await openConversation();
  await expect(messages).toHaveCount(4);
  await expect(days).toHaveText(["Yesterday"]);

  await page.clock.setFixedTime(now + 3 * DAY);
  await page.reload();
  await openConversation();
  await expect(messages).toHaveCount(4);
  await expect(days).toHaveText([await dated(page, dayIn(now, zone))]);
  expect(dayIn(now, zone)).not.toBe(dayIn(now, device));
});

/** The Conversation, in view: on a phone, by its tab. */
async function conversationShown(page: Page, testInfo: TestInfo) {
  await showTab(page, testInfo, "Agent");
  return page.getByRole("region", { name: "Conversation" });
}

test("a Brief says when it was taken in the Context's time zone, under its day", async ({
  page,
}, testInfo) => {
  // The Brief comes at the next minute on the clock, which can be most of two away.
  test.setTimeout(150_000);
  const device = deviceZone(testInfo);
  const zone = zoneApartFrom(device, Date.now());
  // A Context named so, the journeys' scripted model leaves a Brief with something to raise.
  const context = await makeContext(page, {
    name: `Briefed ${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`,
    time_zone: zone,
    accent: "plum",
  });
  // At least a minute off, so the Brief cannot come between its time and the setting of it, as
  // the Context's zone tells the time.
  const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: zone }).format(
    Date.now() + 70_000,
  );
  await callContextTool(page, context.id, "set_brief_time", { time });
  await lastShown(page, context.id);

  await page.goto("/");
  const conversation = await conversationShown(page, testInfo);
  const taken = conversation.getByText(/^Brief, taken /);
  await expect(taken).toBeVisible({ timeout: 120_000 });

  // Its time alone, in the Context's zone, as the Device's locale writes it: the caption above it
  // says its day.
  const { items } = await callContextTool(page, context.id, "list_messages", {});
  const brief = (items as { clock: { taken: string } | null }[]).find((message) => message.clock);
  if (!brief?.clock) throw new Error("The Conversation shows a Brief its read does not hold");
  const shown = await writtenIn(page, Date.parse(brief.clock.taken), zone, { timeStyle: "short" });
  await expect(taken).toHaveText(`Brief, taken ${shown}`);
  const days = conversation.getByRole("list", { name: "Messages" }).getByRole("heading");
  await expect(days).toHaveText(["Today"]);
});

test("an answer being written falls on the day of the Message it answers, as it does once written", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Writing ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "teal" });
  await lastShown(page, context.id);
  // The Device's clock a day on: the Message sent now is on the Context's yesterday by it, and so
  // is the answer to it, being written or written.
  await page.clock.setFixedTime(Date.now() + DAY);
  // The Agent's Message is held on the live channel, and the screen is told its words are being
  // written, as the Worker tells it while a model writes: the journeys' scripted model writes the
  // whole of it at once, so the Worker sends none of what is being written.
  const held: string[] = [];
  let toScreen: ((message: string) => void) | undefined;
  await page.routeWebSocket(/\/live$/, (socket) => {
    const server = socket.connectToServer();
    toScreen = (message) => socket.send(message);
    server.onMessage((message) => {
      const heard = JSON.parse(String(message));
      if (heard.kind !== "message" || heard.message.from !== "agent") return socket.send(message);
      held.push(String(message));
      socket.send(JSON.stringify({ kind: "answer", words: heard.message.words }));
    });
  });

  await page.goto("/");
  const conversation = await conversationShown(page, testInfo);
  const list = conversation.getByRole("list", { name: "Messages" });
  const days = list.getByRole("heading");
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: Being written ${tag}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const writing = list.locator("li[aria-busy=true]").filter({ hasText: `Being written ${tag}` });
  await expect(writing).toBeVisible();
  await expect(days).toHaveText(["Yesterday"]);
  expect(await captionOver(days, writing)).toBe("Yesterday");

  // Written, it stays under the same day.
  await expect.poll(() => held.length).toBe(1);
  for (const message of held.splice(0)) toScreen?.(message);
  const messages = list.getByTestId("message");
  await expect(messages).toHaveCount(2);
  await expect(days).toHaveText(["Yesterday"]);
  expect(await captionOver(days, messages.last())).toBe("Yesterday");
});
