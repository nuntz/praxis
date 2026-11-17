import type { Page } from "@playwright/test";
import { expect, onPhone, sharedContext, test } from "./fixtures.ts";

// The main screen is Attention, the Journal and the Conversation as three peers (section 8.1,
// ADR 0022), in the Atelier look of section 8.11.

/** Blue, the accent of the Context the journeys share. */
const BLUE = { light: "rgb(43, 85, 196)", dark: "rgb(157, 182, 255)" };
/** The ground behind the panels. */
const GROUND = { light: "rgb(236, 238, 242)", dark: "rgb(15, 17, 20)" };

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

test("in between, the Journal and the Conversation stand side by side and Attention opens from the top bar", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "The in-between width is set on the desktop's Device.");
  await page.setViewportSize({ width: 960, height: 800 });
  await page.goto("/");

  await expect(column(page, "Journal")).toBeVisible();
  await expect(column(page, "Conversation")).toBeVisible();
  await expect(column(page, "Attention")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Columns" })).toBeHidden();

  // By keyboard: the button in the top bar opens Attention, and Escape puts it away again.
  const open = page.getByRole("banner").getByRole("button", { name: /^Attention/ });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(column(page, "Attention")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(column(page, "Attention")).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await expect(column(page, "Attention")).toBeVisible();
});

test("on a phone, the screen opens on Attention and three tabs move between the columns", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone has the tabs.");
  await page.goto("/");

  const tabs = page.getByRole("navigation", { name: "Columns" });
  await expect(tabs.getByRole("button")).toHaveText(["Attention", "Journal", "Agent"]);
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
    // The tabs come after the columns, as they are drawn below them.
    const tab = page.getByRole("navigation", { name: "Columns" }).getByRole("button", {
      name: "Journal",
    });
    for (let presses = 0; presses < 10; presses++) {
      await page.keyboard.press("Tab");
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

test("light and dark follow the Device, with no switch", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-color", GROUND.light);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", GROUND.dark);
  await expect(page.getByRole("button", { name: /dark|light|theme/i })).toHaveCount(0);
});
