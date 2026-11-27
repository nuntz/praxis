import type { Page } from "@playwright/test";
import {
  closeSettings,
  contextOfOwn,
  enterSearch,
  expect,
  makeContext,
  onPhone,
  sharedContext,
  showTab,
  switchTo,
  test,
} from "./fixtures.ts";

// The main screen is Attention, the Journal and the Conversation as three peers (section 8.1,
// ADR 0022), in the Atelier look of section 8.11.

/** Blue, the accent of the Context the journeys share. */
const BLUE = { light: "rgb(43, 85, 196)", dark: "rgb(157, 182, 255)" };
/** The ground behind the panels. */
const GROUND = { light: "rgb(236, 238, 242)", dark: "rgb(15, 17, 20)" };
/** What sits inside a panel, and the current tab. */
const INSET = { light: "rgb(244, 245, 248)" };

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("on a desktop, Attention, the Journal and the Conversation stand side by side in that order", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "A phone shows one column at a time.");
  await page.goto("/");

  const boxes = [];
  for (const name of ["Attention", "Journal", "Conversation"]) {
    await expect(column(page, name)).toBeVisible();
    boxes.push(await column(page, name).boundingBox());
  }
  const [attention, journal, conversation] = boxes;
  expect(attention?.x).toBeLessThan(journal?.x ?? 0);
  expect(journal?.x).toBeLessThan(conversation?.x ?? 0);
  // No tabs and no button to open Attention: it is already there.
  await expect(page.getByRole("navigation", { name: "Columns" })).toBeHidden();
  await expect(page.getByRole("banner").getByRole("button", { name: /^Attention/ })).toBeHidden();
});

test("the Journal's column is the same one before the Context's time zone is read and after", async ({
  page,
}) => {
  // Every column the page ever mounts, counted as it lands, so a swap is seen however fast.
  await page.addInitScript(() => {
    const seen = new Set<Element>();
    const mounted: Record<string, number> = {};
    Object.assign(window, { mounted });
    new MutationObserver(() => {
      for (const region of document.querySelectorAll("section[aria-labelledby$='-heading']")) {
        if (seen.has(region)) continue;
        seen.add(region);
        const name = region.id;
        mounted[name] = (mounted[name] ?? 0) + 1;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  // The composer comes with the zone. On a phone it is behind the Journal's tab, so hidden.
  const composer = page.getByRole("textbox", { name: /^Record an Entry in /, includeHidden: true });
  await expect(composer).toBeAttached();
  const mounted = await page.evaluate(() => (window as unknown as { mounted: object }).mounted);
  expect(mounted).toEqual({ attention: 1, journal: 1, conversation: 1 });
});

test("in between, the Journal and the Conversation stand side by side and Attention opens from the top bar as a layer over them", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "The in-between width is set on the desktop's Device.");
  // A Context of its own, so Attention holds only what this journey leaves in it, and Tab walks it.
  await contextOfOwn(page, testInfo, "Layer");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");

  const journal = column(page, "Journal");
  await expect(journal).toBeVisible();
  await expect(column(page, "Conversation")).toBeVisible();
  await expect(column(page, "Attention")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Columns" })).toBeHidden();
  const composer = journal.getByRole("textbox", { name: /^Record an Entry in / });
  await expect(composer).toBeVisible();

  // By keyboard: the button in the top bar opens Attention, and the focus goes to its heading.
  const open = page.getByRole("banner").getByRole("button", { name: /^Attention/ });
  const heading = column(page, "Attention").getByRole("heading", { name: "Attention" });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(column(page, "Attention")).toBeVisible();
  await expect(heading).toBeFocused();

  // Tab goes through Attention and back round by the top bar, never into the columns under it.
  // Past the page's end the focus is on nothing, "none", before Tab wraps to the top bar.
  const where = () =>
    page.evaluate(() => {
      const at = document.activeElement?.closest("#attention, #journal, #conversation, .top-bar");
      return at ? at.id || "top-bar" : "none";
    });
  const visited: string[] = [];
  for (let presses = 0; presses < 40; presses++) {
    await page.keyboard.press("Tab");
    visited.push(await where());
    if (visited.at(-1) === "attention" && visited.includes("top-bar")) break;
  }
  expect(visited.at(-1)).toBe("attention");
  expect(visited).toContain("top-bar");
  expect(visited).not.toContain("journal");
  expect(visited).not.toContain("conversation");

  // Escape puts it away, the focus back on its button.
  await heading.focus();
  await page.keyboard.press("Escape");
  await expect(column(page, "Attention")).toBeHidden();
  await expect(open).toBeFocused();

  // Its own Close does the same.
  await open.click();
  const close = column(page, "Attention").getByRole("button", { name: "Close Attention" });
  await expect(close).toHaveAttribute("title", "Close Attention");
  await close.click();
  await expect(column(page, "Attention")).toBeHidden();
  await expect(open).toBeFocused();

  // A press on the Journal, beside Attention, closes it and does nothing there: the composer it
  // landed on is not given the caret.
  await open.click();
  await expect(heading).toBeFocused();
  const field = await composer.boundingBox();
  const layer = await column(page, "Attention").boundingBox();
  if (!field || !layer) throw new Error("the composer and Attention are shown");
  expect(field.x + field.width).toBeGreaterThan(layer.x + layer.width + 20);
  await page.mouse.click(layer.x + layer.width + 10, field.y + field.height / 2);
  await expect(column(page, "Attention")).toBeHidden();
  await expect(composer).not.toBeFocused();
  await expect(journal.getByTestId("composer")).toHaveAttribute("data-folded");

  // Open, the button sits on inset, and the journey ends on the layer for the accessibility check.
  await open.click();
  await expect(open).toHaveCSS("background-color", INSET.light);
  await expect(heading).toBeFocused();
});

test.describe("on a touch screen in between", () => {
  test.use({ hasTouch: true });

  test("a tap on the Journal beside Attention closes it and lands on nothing there", async ({
    page,
  }, testInfo) => {
    test.skip(onPhone(testInfo), "The in-between width is set on the desktop's Device.");
    await contextOfOwn(page, testInfo, "Tapped beside");
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/");
    const journal = column(page, "Journal");
    const composer = journal.getByRole("textbox", { name: /^Record an Entry in / });
    await expect(composer).toBeVisible();

    // On a touch screen the browser aims the press's mouse events and its click once the finger
    // lifts, at what is under it then: the Journal stays inert until the press is done.
    const open = page.getByRole("banner").getByRole("button", { name: /^Attention/ });
    await open.tap();
    await expect(column(page, "Attention")).toBeVisible();
    const field = await composer.boundingBox();
    const layer = await column(page, "Attention").boundingBox();
    if (!field || !layer) throw new Error("the composer and Attention are shown");
    await page.touchscreen.tap(layer.x + layer.width + 10, field.y + field.height / 2);
    await expect(column(page, "Attention")).toBeHidden();
    // Read once the press's click would have landed: a turn of the page after it.
    await page.evaluate(
      () => new Promise((settled) => setTimeout(() => requestAnimationFrame(settled))),
    );
    await expect(composer).not.toBeFocused();
    await expect(journal.getByTestId("composer")).toHaveAttribute("data-folded");
  });
});

test("in between, the top bar stays live while Attention is open: Settings and the switcher close it first", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "The in-between width is set on the desktop's Device.");
  const other = await makeContext(page, {
    name: `Elsewhere ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "plum",
  });
  await contextOfOwn(page, testInfo, "Live top bar");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  const open = page.getByRole("banner").getByRole("button", { name: /^Attention/ });

  await open.click();
  await expect(column(page, "Attention")).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await closeSettings(page);
  await expect(column(page, "Attention")).toBeHidden();
  await expect(open).toHaveAttribute("aria-expanded", "false");

  await open.click();
  await expect(column(page, "Attention")).toBeVisible();
  await switchTo(page, other.name);
  await expect(column(page, "Journal")).toBeVisible();
  await expect(column(page, "Attention")).toBeHidden();
  await expect(open).toHaveAttribute("aria-expanded", "false");
});

test("at 720px the Conversation is as wide as the Journal, and Record lies wholly inside the Journal", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "The in-between width is set on the desktop's Device.");
  await page.setViewportSize({ width: 720, height: 800 });
  await page.goto("/");

  const journal = column(page, "Journal");
  const record = journal.getByRole("button", { name: "Record", exact: true });
  await expect(record).toBeVisible();
  const [panel, button, conversation] = await Promise.all([
    journal.boundingBox(),
    record.boundingBox(),
    column(page, "Conversation").boundingBox(),
  ]);
  if (!panel || !button || !conversation) throw new Error("the Journal and Record are shown");
  expect(Math.abs(conversation.width - panel.width)).toBeLessThanOrEqual(1);
  expect(button.x).toBeGreaterThanOrEqual(panel.x);
  expect(button.x + button.width).toBeLessThanOrEqual(panel.x + panel.width);
  // Its icon and its word, both kept.
  await expect(record).toHaveText("Record");
  await expect(record.locator("svg")).toBeVisible();
});

test("on a phone, the screen opens on Attention and three tabs move between the columns", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone has the tabs.");
  await page.goto("/");

  const tabs = page.getByRole("navigation", { name: "Columns" });
  // The Attention tab carries its count, whatever the other journeys left Due.
  await expect(tabs.getByRole("button")).toHaveText([/^Attention/, "Journal", "Agent"]);
  await expect(column(page, "Attention")).toBeVisible();
  await expect(column(page, "Journal")).toBeHidden();
  await expect(column(page, "Conversation")).toBeHidden();
  await expect(tabs.getByRole("button", { name: "Attention" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await tabs.getByRole("button", { name: "Agent" }).click();
  await expect(column(page, "Conversation")).toBeVisible();
  await expect(column(page, "Attention")).toBeHidden();

  await tabs.getByRole("button", { name: "Journal" }).click();
  await expect(column(page, "Journal")).toBeVisible();
  await expect(column(page, "Conversation")).toBeHidden();
});

test("the person records an Entry by keyboard alone, in a composer that names its Context in its accent", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const { name } = await sharedContext(page);
  await page.goto("/");

  const journal = column(page, "Journal");
  const composer = journal.getByRole("textbox", { name: `Record an Entry in ${name}` });
  const switcher = page.getByRole("banner").getByRole("button", { name: `Context: ${name}` });
  await expect(switcher).toBeVisible();
  if (onPhone(testInfo)) {
    // The tabs come after the columns, as they are drawn below them, so they are reached going
    // back from the page's end: going forward passes whatever Attention holds first.
    const tab = page.getByRole("navigation", { name: "Columns" }).getByRole("button", {
      name: "Journal",
    });
    for (let presses = 0; presses < 4; presses++) {
      await page.keyboard.press("Shift+Tab");
      if (await tab.evaluate((button) => button === document.activeElement)) break;
    }
    await page.keyboard.press("Enter");
    await expect(composer).toBeVisible();
    // Back past the Attention tab, into the Journal.
    await page.keyboard.press("Shift+Tab");
  } else {
    await expect(composer).toBeVisible();
  }
  // The composer is the last thing in the Journal, and the Record button is off while it is empty.
  // On a desktop the Conversation's own composer comes after it, and is passed going back.
  for (let presses = 0; presses < 4; presses++) {
    await page.keyboard.press("Shift+Tab");
    if (await composer.evaluate((field) => field === document.activeElement)) break;
  }
  await expect(composer).toBeFocused();
  await page.keyboard.type(`Recorded by keyboard ${tag}`);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(journal.getByTestId("entry").filter({ hasText: tag })).toBeVisible();

  // The Context's accent marks the top bar and the composer.
  const frame = journal.getByTestId("composer");
  await expect(switcher).toHaveCSS("background-color", BLUE.light);
  await expect(frame).toHaveCSS("border-top-color", BLUE.light);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(switcher).toHaveCSS("background-color", BLUE.dark);
  await expect(frame).toHaveCSS("border-top-color", BLUE.dark);
});

test("at rest each composer is one line, its label where the words will go, and opens to two lines once focused", async ({
  page,
}, testInfo) => {
  const { name } = await sharedContext(page);
  await page.goto("/");
  for (const [tab, title, label] of [
    ["Journal", "Journal", `Record an Entry in ${name}`],
    ["Agent", "Conversation", `Message the Agent in ${name}`],
  ] as const) {
    await showTab(page, testInfo, tab);
    const shown = column(page, title);
    const field = shown.getByRole("textbox", { name: label, exact: true });
    const frame = shown
      .locator("form")
      .filter({ has: page.getByRole("textbox", { name: label, exact: true }) });
    const words = shown.getByText(label, { exact: true });
    const boxOf = async (part: typeof field) => {
      const box = await part.boundingBox();
      if (!box) throw new Error(`${title}'s composer is shown`);
      return box;
    };
    const leave = () => shown.getByRole("heading", { name: title, exact: true }).click();
    await expect(field).toBeVisible();

    // At rest its label is on the field's one line, where the words will go.
    const atRest = await boxOf(frame);
    let [labelBox, fieldBox] = [await boxOf(words), await boxOf(field)];
    expect(labelBox.y).toBeGreaterThanOrEqual(fieldBox.y);
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(fieldBox.y + fieldBox.height);

    // Focused, it opens at once, its label above the field.
    await field.click();
    await expect(field).toBeFocused();
    const opened = await boxOf(frame);
    expect(opened.height).toBeGreaterThan(atRest.height + 20);
    [labelBox, fieldBox] = [await boxOf(words), await boxOf(field)];
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(fieldBox.y);

    // Left with words in it, it stays open; left empty, it folds back to its one line.
    await field.fill("Half a thought");
    await leave();
    await expect(field).not.toBeFocused();
    // Read once a fold would have run: it waits for the press to be done, then a turn of the page.
    await page.evaluate(
      () => new Promise((settled) => setTimeout(() => requestAnimationFrame(settled))),
    );
    await expect(frame).not.toHaveAttribute("data-folded");
    expect((await boxOf(frame)).height).toBe(opened.height);
    await field.fill("");
    await leave();
    await expect.poll(async () => (await boxOf(frame)).height).toBe(atRest.height);
  }
});

test("each composer grows with its words past two lines, up to 40% of its column, then scrolls within itself", async ({
  page,
}, testInfo) => {
  const { name } = await sharedContext(page);
  await page.goto("/");
  for (const [tab, title, label, send] of [
    ["Journal", "Journal", `Record an Entry in ${name}`, "Record"],
    ["Agent", "Conversation", `Message the Agent in ${name}`, "Send"],
  ] as const) {
    await showTab(page, testInfo, tab);
    const shown = column(page, title);
    const field = shown.getByRole("textbox", { name: label, exact: true });
    const frame = shown
      .locator("form")
      .filter({ has: page.getByRole("textbox", { name: label, exact: true }) });
    const heightOf = async (part: typeof field) => {
      const box = await part.boundingBox();
      if (!box) throw new Error(`${title}'s composer is shown`);
      return box.height;
    };
    await field.click();
    await expect(field).toBeFocused();
    const twoLines = await heightOf(field);
    const opened = await heightOf(frame);
    const lines = (count: number) =>
      Array.from({ length: count }, (_, at) => `Line ${at + 1}`).join("\n");

    // Past its two lines it grows by a line for each line more.
    await field.fill(lines(3));
    await expect.poll(() => heightOf(field)).toBe((twoLines * 3) / 2);
    await field.fill(lines(4));
    await expect.poll(() => heightOf(field)).toBe(twoLines * 2);

    // Up to 40% of its column, within a line of it, and then the words scroll within it, the send
    // still in view beside them.
    await field.fill(lines(60));
    const ceiling = (await heightOf(shown)) * 0.4;
    await expect.poll(() => heightOf(frame)).toBeGreaterThan(ceiling - twoLines / 2);
    expect(await heightOf(frame)).toBeLessThanOrEqual(ceiling);
    expect(await field.evaluate((words) => words.scrollHeight > words.clientHeight)).toBe(true);
    await expect(shown.getByRole("button", { name: send, exact: true })).toBeInViewport();

    // Fewer words, it shrinks again, never below its two lines while it has the focus.
    await field.fill(lines(3));
    await expect.poll(() => heightOf(field)).toBe((twoLines * 3) / 2);
    await field.fill("Back to one");
    await expect.poll(() => heightOf(frame)).toBe(opened);
    await field.fill("");
    await expect(field).toBeFocused();
    expect(await heightOf(frame)).toBe(opened);
  }
});

test("light and dark follow the Device, with no switch", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-color", GROUND.light);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", GROUND.dark);
  await expect(page.getByRole("button", { name: /dark|light|theme/i })).toHaveCount(0);
});

/** What a Journal with no Entries says, naming its Context. */
const nothingRecorded = (page: Page, name: string) =>
  column(page, "Journal").getByText(`Nothing recorded in ${name} yet.`, { exact: true });

test("in a Context with nothing in it, the Journal and the Conversation each say so, naming it", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Empty");
  await page.goto("/");

  await showTab(page, testInfo, "Journal");
  const journal = column(page, "Journal");
  await expect(nothingRecorded(page, context.name)).toBeVisible();

  await showTab(page, testInfo, "Agent");
  await expect(
    column(page, "Conversation").getByText(`Nothing said to the Agent in ${context.name} yet.`, {
      exact: true,
    }),
  ).toBeVisible();

  // A search that finds nothing says so, and not that the Journal holds nothing.
  await showTab(page, testInfo, "Journal");
  const field = await enterSearch(page);
  await field.fill("nowhere");
  await expect(journal.getByText("Nothing found for “nowhere”")).toBeVisible();
  await expect(nothingRecorded(page, context.name)).toHaveCount(0);
  // The search ended, the Journal says it again.
  await page.keyboard.press("Escape");
  await expect(nothingRecorded(page, context.name)).toBeVisible();
});

test("once an Entry is recorded in a Context with nothing in it, the Journal no longer says so", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "First");
  await page.goto("/");
  await showTab(page, testInfo, "Journal");
  const journal = column(page, "Journal");
  await expect(nothingRecorded(page, context.name)).toBeVisible();

  const composer = journal.getByRole("textbox", { name: `Record an Entry in ${context.name}` });
  await composer.fill("The first thing written here");
  await journal.getByRole("button", { name: "Record", exact: true }).click();
  await expect(journal.getByTestId("entry")).toHaveCount(1);
  await expect(nothingRecorded(page, context.name)).toHaveCount(0);
});
