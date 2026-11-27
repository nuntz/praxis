import type { Locator, Page } from "@playwright/test";
import {
  callContextTool,
  expect,
  lastShown,
  makeContext,
  openJournal,
  showTab,
  test,
} from "./fixtures.ts";

// The Journal and the Conversation open at their newest, beside their composer, and stay there as
// more arrives; scrolled away, a column keeps its place and a pill takes the person back; their own
// send always comes into view (section 8.1). Each journey makes a Context of its own, so what fills
// its columns, and in what order, is its own.

/** Words that take several lines, so a column of a few overflows at desktop and phone width. */
function tall(first: string, lines: number): string {
  return [first, ...Array.from({ length: lines }, (_, at) => `Line ${at + 1} of ${first}`)].join(
    "\n\n",
  );
}

/** Where something sits on the screen, read once it is shown. */
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Not shown, so it has no place to read");
  return box.y;
}

/** Where something ends on the screen, read once it is shown. */
async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Not shown, so it has no place to read");
  return box.y + box.height;
}

/** The `rule` hairline, in the light the journeys run in. */
const RULE = "rgb(213, 217, 224)";

/** Scroll a column to its very top as the person does, with the wheel over what it holds. */
async function scrollToTop(page: Page, within: Locator) {
  await within.hover();
  await page.mouse.wheel(0, -100_000);
}

/** Scroll a column as the person does, until this is in view. */
async function scrollTo(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  // The column hears the scroll before the journey goes on.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

test("the Journal opens at its newest Entry, stays there as Entries arrive, and keeps its place scrolled up", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Newest ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  for (let at = 1; at <= 12; at++) {
    await callContextTool(page, context.id, "record_entry", {
      words: tall(`Entry ${at} ${tag}`, 3),
    });
  }
  await lastShown(page, context.id);
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const entries = journal.getByTestId("entry");
  await expect(entries).toHaveCount(12);

  // It opens at its newest, the oldest out of view above, cut under the header at an edge.
  await expect(entries.last()).toBeInViewport();
  await expect(entries.first()).not.toBeInViewport();
  const cut = journal.locator(".peer-body");
  await expect(cut).toHaveCSS("border-top-color", RULE);

  // At the newest, an Entry the Agent records comes into view.
  const ask = (words: string) =>
    callContextTool(page, context.id, "send_message", { words: `Record: ${words}` });
  const agents = `The Agent's first ${tag}`;
  await ask(agents);
  await expect(entries.filter({ hasText: agents })).toBeInViewport();

  // Scrolled up, the next leaves the column where it was, and the pill says so.
  await scrollTo(page, entries.first());
  const before = await topOf(entries.first());
  const later = `The Agent's second ${tag}`;
  await ask(later);
  const pill = journal.getByRole("button", { name: "1 new · Jump to latest", exact: true });
  await expect(pill).toBeVisible();
  await expect(entries.filter({ hasText: later })).toHaveCount(1);
  expect(await topOf(entries.first())).toBe(before);
  await expect(entries.filter({ hasText: later })).not.toBeInViewport();

  // The pill brings the newest into view, and goes.
  await pill.click();
  await expect(entries.filter({ hasText: later })).toBeInViewport();
  await expect(pill).toHaveCount(0);

  // The person's own Entry, recorded while scrolled up, is in view once recorded.
  await scrollTo(page, entries.first());
  await expect(entries.filter({ hasText: later })).not.toBeInViewport();
  const mine = `Recorded by hand ${tag}`;
  await composer.fill(mine);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(entries.filter({ hasText: mine })).toBeInViewport();

  // Scrolled to the very top, nothing is cut, and there is no edge.
  await scrollToTop(page, entries.first());
  await expect(cut).not.toHaveCSS("border-top-color", RULE);
});

test("the newest Entry stays just above the composer as its words grow, and so does Jump to latest", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Growing ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  for (let at = 1; at <= 8; at++) {
    await callContextTool(page, context.id, "record_entry", {
      words: tall(`Entry ${at} ${tag}`, 3),
    });
  }
  await lastShown(page, context.id);
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const entries = journal.getByTestId("entry");
  await expect(entries).toHaveCount(8);
  const frame = journal.getByTestId("composer");
  const words = (count: number) =>
    Array.from({ length: count }, (_, at) => `Growing line ${at + 1}`).join("\n");

  // At its newest, the newest Entry stays in view above the composer as the composer grows.
  await composer.click();
  const before = await topOf(frame);
  await composer.fill(words(40));
  await expect.poll(() => topOf(frame)).toBeLessThan(before - 100);
  await expect(entries.last()).toBeInViewport();
  expect(await bottomOf(entries.last())).toBeLessThanOrEqual(await topOf(frame));

  // Scrolled a little way up from the newest, the composer growing leaves the column where it was.
  await composer.fill(words(3));
  const lower = await topOf(frame);
  const body = journal.locator(".peer-body");
  await body.evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 60;
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const scrolledTo = await body.evaluate((scroller) => scroller.scrollTop);
  await composer.fill(words(6));
  await expect.poll(() => topOf(frame)).toBeLessThan(lower - 50);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await body.evaluate((scroller) => scroller.scrollTop)).toBe(scrolledTo);
  await composer.fill(words(40));

  // Scrolled away, the pill back to the newest stands above the composer grown.
  await scrollTo(page, entries.first());
  const later = `The Agent's ${tag}`;
  await callContextTool(page, context.id, "send_message", { words: `Record: ${later}` });
  const pill = journal.getByRole("button", { name: "1 new · Jump to latest", exact: true });
  await expect(pill).toBeVisible();
  expect(await bottomOf(pill)).toBeLessThanOrEqual(await topOf(frame));

  // Recorded by its button, which then has nothing to send, the composer folds back to its one
  // line, and what it recorded is in view above it.
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(composer).toHaveValue("");
  await expect(frame).toHaveAttribute("data-folded");
  await expect.poll(() => topOf(frame)).toBeGreaterThan(before);
  await expect(entries.filter({ hasText: "Growing line 1" })).toBeInViewport();
});

test("Show earlier adds older Entries above and keeps the Entry in view where it was", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Earlier ${tag}`,
    time_zone: "UTC",
    accent: "moss",
  });
  // The oldest few are tall, so that added above with no care they would push what is shown down
  // and out of view. A page is 50 Entries, so these five are on the page before the first shown.
  for (let at = 1; at <= 5; at++) {
    await callContextTool(page, context.id, "record_entry", { words: tall(`Old ${at} ${tag}`, 8) });
  }
  for (let at = 1; at <= 50; at++) {
    await callContextTool(page, context.id, "record_entry", { words: `Newer ${at} ${tag}` });
  }
  await lastShown(page, context.id);
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const entries = journal.getByTestId("entry");
  await expect(entries).toHaveCount(50);
  await expect(entries.last()).toBeInViewport();

  const earlier = journal.getByRole("button", { name: "Show earlier Entries", exact: true });
  await scrollTo(page, earlier);
  const oldestShown = entries.filter({ hasText: `Newer 1 ${tag}` });
  await expect(oldestShown).toBeInViewport();
  await earlier.click();
  await expect(entries).toHaveCount(55);
  await expect(oldestShown).toBeInViewport();
  await expect(entries.filter({ hasText: `Old 1 ${tag}` })).not.toBeInViewport();
});

test("the Conversation opens at its newest Message, keeps its place scrolled up, and brings the person's own into view", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Talk ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "plum" });
  for (let at = 1; at <= 4; at++) {
    await callContextTool(page, context.id, "send_message", {
      words: `Say: ${tall(`Answer ${at} ${tag}`, 6)}`,
    });
  }
  await lastShown(page, context.id);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages).toHaveCount(8);
  await expect(messages.last()).toContainText(`Answer 4 ${tag}`);

  // It opens at its newest, the oldest out of view above, cut under the header at an edge.
  await expect(messages.last()).toBeInViewport();
  await expect(messages.first()).not.toBeInViewport();
  await expect(conversation.locator(".peer-body")).toHaveCSS("border-top-color", RULE);

  // Scrolled up, what arrives leaves the column where it was, and the pill says so.
  await scrollTo(page, messages.first());
  const before = await topOf(messages.first());
  await callContextTool(page, context.id, "send_message", { words: `Say: From elsewhere ${tag}` });
  const pill = conversation.getByRole("button", { name: /^\d+ new · Jump to latest$/ });
  await expect(pill).toBeVisible();
  await expect(messages).toHaveCount(10);
  expect(await topOf(messages.first())).toBe(before);
  await expect(messages.last()).not.toBeInViewport();

  // The person's own Message, sent while scrolled up, is in view once sent, and the pill goes.
  const mine = `Sent by hand ${tag}`;
  const field = conversation.getByRole("textbox", {
    name: `Message the Agent in ${name}`,
    exact: true,
  });
  await field.fill(mine);
  const send = conversation.getByRole("button", { name: "Send", exact: true });
  await send.click();
  await expect(messages.filter({ hasText: mine })).toBeInViewport();
  await expect(pill).toHaveCount(0);

  // As its words grow, the newest Message stays just above the composer, which folds back to its
  // one line once they are sent by its button.
  const frame = field.locator("xpath=ancestor::form");
  await field.click();
  const opened = await topOf(frame);
  const grown = Array.from({ length: 40 }, (_, at) => `Growing line ${at + 1}`).join("\n");
  await field.fill(grown);
  await expect.poll(() => topOf(frame)).toBeLessThan(opened - 100);
  await expect(messages.last()).toBeInViewport();
  expect(await bottomOf(messages.last())).toBeLessThanOrEqual(await topOf(frame));
  await send.click();
  await expect(field).toHaveValue("");
  await expect(frame).toHaveAttribute("data-folded");
  await expect(messages.filter({ hasText: "Growing line 1" })).toBeInViewport();
});
