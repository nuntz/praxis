import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  contextOfOwn,
  enterSearch,
  expect,
  onPhone,
  openJournal,
  pickTime,
  test,
} from "./fixtures.ts";

// Chips under the search field narrow what is found (section 8.4). The time chip keeps a search to
// days reckoned in the Context's time zone from today there, both ends included, and sends them as
// the tool's `from` and `to`.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The day an instant falls on in a zone, `YYYY-MM-DD`. */
function dayIn(at: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
}

/** The day `days` after this one, by the calendar. */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
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

/** An instant on this day in the Context's zone that falls on another day in the Device's. */
function onDayApart(day: string, zone: string, device: string, now: number): number {
  for (let at = now - 6 * DAY; at < now; at += 15 * 60 * 1000) {
    if (dayIn(at, zone) === day && dayIn(at, device) !== day) return at;
  }
  throw new Error(`No instant on ${day} in ${zone} that is another day in ${device}`);
}

/** The last instant of a day in a zone: a minute before the next day starts there. */
function endOfDay(day: string, zone: string, now: number): number {
  for (let at = now - 7 * DAY; at < now; at += 60 * 1000) {
    if (dayIn(at, zone) === day && dayIn(at + 60 * 1000, zone) !== day) return at;
  }
  throw new Error(`No end of ${day} in ${zone} in the last week`);
}

/** How the Device's locale writes a range of days, as the set time chip says it. */
async function rangeWritten(page: Page, from: string, to: string, today: string) {
  const locale = await page.evaluate(() => navigator.language);
  const year = [from, to].some((day) => day.slice(0, 4) !== today.slice(0, 4));
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).formatRange(Date.parse(`${from}T12:00:00Z`), Date.parse(`${to}T12:00:00Z`));
}

/** The words of every search the screen asks, in the order asked. */
function searchesAsked(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/tools/search")) asked.push(request.postDataJSON().words);
  });
  return asked;
}

/**
 * Press Tab until the focus is on a control, as a keyboard reaches it: a date field takes several,
 * one for each of its parts, as the browser draws it.
 */
async function tabTo(page: Page, control: Locator) {
  for (let tabs = 0; tabs < 8; tabs += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
}

async function openSearch(page: Page, testInfo: TestInfo) {
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const field = await enterSearch(page);
  const chips = journal.getByRole("group", { name: "Narrow the search" });
  const found = journal.getByRole("region", { name: "Found" });
  const excerpts = found.getByTestId("search-excerpt");
  // What is found, whatever order the tool ranks it in.
  const foundWords = () =>
    expect.poll(async () => (await excerpts.allTextContents()).sort(), { timeout: 10_000 });
  return { journal, field, chips, found, excerpts, foundWords };
}

test("the time chip keeps a search to recent days, says what it holds, and lifts with one tap", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const context = await contextOfOwn(page, testInfo, "Recent");
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  for (const [words, days] of [
    ["Sixty days ago", 60],
    ["Twenty days ago", 20],
    ["Four days ago", 4],
  ] as const) {
    await callContextTool(page, context.id, "record_entry", {
      words: `${words} ${tag}`,
      made_at: ago(days),
    });
  }
  await callContextTool(page, context.id, "record_entry", { words: `Just now ${tag}` });
  const asked = searchesAsked(page);
  const { journal, field, chips, found, excerpts, foundWords } = await openSearch(page, testInfo);

  // Not set, the chip is a surface pill with a hairline, saying what it would narrow by.
  const anyTime = chips.getByRole("button", { name: "Any time" });
  await expect(anyTime).toHaveAttribute("aria-expanded", "false");
  await expect(anyTime).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(anyTime).toHaveCSS("border-color", "rgb(213, 217, 224)");

  // Nothing is asked before a chip is set or words are typed.
  expect(asked).toEqual([]);

  // Set with no words, it lists everything made in its days, newest first, in place of the
  // Entries, under a count that names the time.
  await anyTime.click();
  const picker = journal.getByRole("dialog", { name: "Time" });
  await expect(picker.getByRole("button")).toHaveText([
    "Any time",
    "Today",
    "Last 7 days",
    "Last 30 days",
    "Search these days",
  ]);
  await picker.getByRole("button", { name: "Last 7 days" }).click();
  await expect(picker).toHaveCount(0);
  // Set, it is ink with surface text, says what it holds, and is named for lifting it.
  const lastWeek = chips.getByRole("button", { name: "Last 7 days, remove" });
  await expect(lastWeek).toHaveText("Last 7 days");
  await expect(lastWeek).toBeFocused();
  await expect(lastWeek).toHaveCSS("background-color", "rgb(26, 29, 35)");
  await expect(lastWeek).toHaveCSS("color", "rgb(255, 255, 255)");
  const status = found.getByRole("status");
  await expect(status).toHaveText("Everything from the last 7 days, newest first");
  await expect(excerpts).toHaveText([`Just now ${tag}`, `Four days ago ${tag}`]);
  const entries = journal.getByRole("list", { name: "Entries" });
  await expect(entries).toBeHidden();

  // Lifted with nothing else set, nothing is asked. Wider than a phone the Entries are shown
  // again; on a phone the search keeps its screen until its back arrow.
  await lastWeek.click();
  await expect(found).toHaveCount(0);
  if (onPhone(testInfo)) await expect(entries).toBeHidden();
  else await expect(entries).toBeVisible();
  await anyTime.click();
  await picker.getByRole("button", { name: "Last 7 days" }).click();
  await expect(excerpts).toHaveCount(2);

  await field.fill(tag);
  await foundWords().toEqual([`Four days ago ${tag}`, `Just now ${tag}`]);

  // Lifted with one tap, it reads the list again over any time.
  await lastWeek.click();
  await expect(anyTime).toBeFocused();
  await expect(excerpts).toHaveCount(4);

  await anyTime.click();
  await picker.getByRole("button", { name: "Last 30 days" }).click();
  await expect(chips.getByRole("button", { name: "Last 30 days, remove" })).toBeVisible();
  await foundWords().toEqual([`Four days ago ${tag}`, `Just now ${tag}`, `Twenty days ago ${tag}`]);
  // Clearing the words goes back to everything from those days.
  await field.fill("");
  await expect(status).toHaveText("Everything from the last 30 days, newest first");
  await expect(excerpts).toHaveText([
    `Just now ${tag}`,
    `Four days ago ${tag}`,
    `Twenty days ago ${tag}`,
  ]);
  await field.fill(tag);

  await chips.getByRole("button", { name: "Last 30 days, remove" }).click();
  await anyTime.click();
  await picker.getByRole("button", { name: "Today" }).click();
  await expect(excerpts).toHaveText([`Just now ${tag}`]);

  // Left on the time chip's list alone with its count, so the accessibility check sees them.
  await field.fill("");
  await expect(status).toHaveText("Everything from today, newest first");
  await expect(excerpts).toHaveText([`Just now ${tag}`]);
});

test("the time chip reckons its days in the Context's zone, a range of days held at both ends, and is worked from the keyboard", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const device = testInfo.project.use.timezoneId as string;
  const now = Date.now();
  const zone = zoneApartFrom(device, now);
  const context = await contextOfOwn(page, testInfo, "Zoned", zone);
  const today = dayIn(now, zone);
  const [first, last] = [addDays(today, -4), addDays(today, -3)];
  // Each made on a day the Device's zone would put on another, or at the very end of its day.
  const made: [string, number][] = [
    ["Before the range", endOfDay(addDays(first, -1), zone, now)],
    ["First day", onDayApart(first, zone, device, now)],
    ["Last day", endOfDay(last, zone, now)],
    ["After the range", onDayApart(addDays(last, 1), zone, device, now)],
    ["Yesterday", onDayApart(addDays(today, -1), zone, device, now)],
  ];
  for (const [words, at] of made) {
    await callContextTool(page, context.id, "record_entry", {
      words: `${words} ${tag}`,
      made_at: new Date(at).toISOString(),
    });
  }
  await callContextTool(page, context.id, "record_entry", { words: `Today ${tag}` });
  const { journal, field, chips, found, excerpts, foundWords } = await openSearch(page, testInfo);
  const status = found.getByRole("status");
  await field.fill(tag);
  await expect(excerpts).toHaveCount(6);

  // Today is the Context's, which is another day on the Device.
  const anyTime = chips.getByRole("button", { name: "Any time" });
  await anyTime.focus();
  await page.keyboard.press("Enter");
  const picker = journal.getByRole("dialog", { name: "Time" });
  await expect(picker.getByRole("button", { name: "Any time" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(picker.getByRole("button", { name: "Today" })).toBeFocused();
  await page.keyboard.press("Enter");
  const todayChip = chips.getByRole("button", { name: "Today, remove" });
  await expect(todayChip).toBeFocused();
  await expect(excerpts).toHaveText([`Today ${tag}`]);
  await page.keyboard.press("Enter");
  await expect(anyTime).toBeFocused();
  await expect(excerpts).toHaveCount(6);

  // A range of days, its two fields named and reached by Tab, both ends included.
  await page.keyboard.press("Enter");
  const from = picker.getByLabel("From", { exact: true });
  await tabTo(page, from);
  await from.fill(first);
  const to = picker.getByLabel("To", { exact: true });
  await tabTo(page, to);
  await to.fill(last);
  await page.keyboard.press("Enter");
  const range = await rangeWritten(page, first, last, today);
  const rangeChip = chips.getByRole("button", { name: `${range}, remove` });
  await expect(rangeChip).toHaveText(range);
  await foundWords().toEqual([`First day ${tag}`, `Last day ${tag}`]);
  // With no words, the range lists what was made in its days, the count naming them as the chip.
  await field.fill("");
  await expect(status).toHaveText(`Everything from ${range}, newest first`);
  await expect(excerpts).toHaveText([`Last day ${tag}`, `First day ${tag}`]);
  await field.fill(tag);
  await rangeChip.click();

  // With no words, Today lists what was made today there, and not what was made the day before.
  await pickTime(page, "Today");
  await field.fill("");
  await expect(status).toHaveText("Everything from today, newest first");
  await expect(excerpts).toHaveText([`Today ${tag}`]);
  await field.fill(tag);
  await todayChip.click();

  // Escape puts the picker away and leaves the search as it was.
  await expect(excerpts).toHaveCount(6);
  await anyTime.click();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(anyTime).toBeFocused();
  await expect(field).toHaveValue(tag);

  // Left open, so the accessibility check sees the picker and its fields.
  await anyTime.click();
  await expect(picker.getByLabel("From", { exact: true })).toBeVisible();
});
