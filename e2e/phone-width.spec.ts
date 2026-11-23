import type { Locator, Page } from "@playwright/test";
import { callContextTool, expect, lastShown, makeContext, onPhone, test } from "./fixtures.ts";

// On a phone each column fills the screen's width, one at a time behind three tabs (section 8.1),
// and nothing in it reaches past the right edge: no page wider than the screen, and no column
// scrolling sideways under its words.

/**
 * What in the page and in this column spills past the screen's right edge, or scrolls sideways.
 * The edge is the Device's, since a phone's browser widens the page's own to fit what spills, and
 * zooms out to show it all: what the page measures of itself then always fits.
 */
async function spills(page: Page, column: Locator) {
  const width = page.viewportSize()?.width;
  if (!width) throw new Error("The phone has a width");
  return column.evaluate((region, width) => {
    const named = (element: Element) =>
      `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
    const found: string[] = [];
    if (document.documentElement.scrollWidth > width) {
      found.push(`the page, ${document.documentElement.scrollWidth}px wide in ${width}px`);
    }
    for (const element of [region, ...region.querySelectorAll("*")]) {
      const box = element.getBoundingClientRect();
      // Nothing shown, or a name kept for a screen reader alone, in a box of a pixel.
      if (box.width <= 1 && box.height <= 1) continue;
      // Search's chips are one row that scrolls sideways on a phone, by design (section 8.4).
      if (element.closest('[aria-label="Narrow the search"]')) continue;
      if (box.right > width + 0.5) found.push(`${named(element)} ends at ${box.right}px`);
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        found.push(`${named(element)} scrolls sideways`);
      }
    }
    return found;
  }, width);
}

/** Choose a tab of the phone's three, and wait until its column shows. */
async function openTab(page: Page, tab: string, column: string) {
  await page
    .getByRole("navigation", { name: "Columns" })
    .getByRole("button", { name: tab })
    .click();
  const shown = page.getByRole("region", { name: column, exact: true });
  await expect(shown).toBeVisible();
  return shown;
}

test("on a phone, each tab fits the screen's width, the Conversation's long Messages included", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone shows one column across its whole width.");
  const tag = crypto.randomUUID();
  // A long name, which the Conversation's subtitle and both composers' labels carry.
  const name = `The house on the hill and everything about it ${tag.slice(0, 8)}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "rust" });
  await lastShown(page, context.id);
  await callContextTool(page, context.id, "record_entry", {
    words: `Errands for the house, with an address too long for one line: https://forms.example.com/${"long-path-".repeat(12)}${tag}`,
    tasks: [
      { title: "Post the parcel" },
      { title: `Ring the plumber about ${"the-boiler-".repeat(6)}` },
    ],
  });
  await page.goto("/");

  // Attention, which the screen opens on, its Task rows across the column.
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const rows = attention.getByRole("region", { name: "Loose", exact: true }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  expect(await spills(page, attention)).toEqual([]);
  await expectAcross(page, attention, rows);

  const journal = await openTab(page, "Journal", "Journal");
  await expect(
    journal.getByTestId("entry").filter({ hasText: "Errands for the house" }),
  ).toBeVisible();
  expect(await spills(page, journal)).toEqual([]);

  // The person's own Message, and the Agent's answer as Markdown, each long and with a long word.
  const conversation = await openTab(page, "Agent", "Conversation");
  const long = `${"A Message long enough to wrap onto many lines on a phone, ".repeat(4)}with ${"an-unbroken-word-".repeat(8)} and https://forms.example.com/${"offsite-".repeat(14)}${tag}`;
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: **${long}**`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages).toHaveCount(2);
  await expect(messages.last().getByText(tag, { exact: false })).toBeVisible();
  expect(await spills(page, conversation)).toEqual([]);
});

/** The column spans the screen, and each row spans the column, its gutters even on either side. */
async function expectAcross(page: Page, column: Locator, rows: Locator) {
  const width = page.viewportSize()?.width;
  const box = await column.boundingBox();
  if (!width || !box) throw new Error("The column and the screen have a width once shown");
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.width).toBeCloseTo(width, 0);
  for (const row of await rows.all()) {
    const shown = await row.boundingBox();
    if (!shown) throw new Error("A row shown has a box");
    const left = shown.x - box.x;
    const right = box.x + box.width - (shown.x + shown.width);
    expect(left, "the row's gutter on the left").toBeGreaterThan(0);
    expect(right, "the row's gutter on the right").toBeCloseTo(left, 0);
  }
}
