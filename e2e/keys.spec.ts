import type { Page } from "@playwright/test";
import { callContextTool, contextOfOwn, expect, onPhone, test } from "./fixtures.ts";

// The main screen's ways past what stands before the composers: skip links as its first Tab stops,
// and outside a field, `r`, `m` and `a` (section 8.11).

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** The two composers' fields, which come with the Context's time zone. */
function composers(page: Page) {
  return {
    entry: column(page, "Journal").getByRole("textbox", { name: /^Record an Entry in / }),
    message: column(page, "Conversation").getByRole("textbox", { name: /^Message the Agent in / }),
  };
}

test("on a desktop the first Tab reaches the skip link to the Journal's composer, which gives it the caret", async ({
  page,
}, testInfo) => {
  test.skip(
    onPhone(testInfo),
    "A phone's skip links switch tabs first, in a journey of their own.",
  );
  await page.goto("/");
  const { entry } = composers(page);
  await expect(entry).toBeVisible();

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to the Journal's composer" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(entry).toBeFocused();

  // The next two links follow it, and the last focuses Attention's heading.
  await page.reload();
  await expect(entry).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to the Conversation's composer" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const toAttention = page.getByRole("link", { name: "Skip to Attention" });
  await expect(toAttention).toBeFocused();
  // Tab goes on from the last link into the top bar, which the link covered while focused.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("banner").getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(toAttention).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(column(page, "Attention").getByRole("heading", { name: "Attention" })).toBeFocused();

  // The journey ends on a skip link shown, at the top left, for the accessibility check.
  await page.reload();
  await expect(entry).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  if (!box) throw new Error("the skip link is shown");
  expect(box.x).toBeLessThan(20);
  expect(box.y).toBeLessThan(20);
});

test("on a desktop r and m give their composer the caret from the page, and in a field each is typed, not taken", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "A phone's keys switch tabs first, in a journey of their own.");
  await page.goto("/");
  const { entry, message } = composers(page);
  await expect(entry).toBeVisible();
  await expect(message).toBeVisible();
  await expect(entry).toHaveAttribute("aria-keyshortcuts", "r");
  await expect(message).toHaveAttribute("aria-keyshortcuts", "m");

  // At rest each composer shows its key at the end of its label; focused, none.
  const entryKey = column(page, "Journal").getByTestId("composer").locator(".composer-key");
  await expect(entryKey).toHaveText("r");
  await expect(entryKey).toBeVisible();

  // With nothing focused, `r` gives the Journal's composer the caret and types nothing there.
  await page.keyboard.press("r");
  await expect(entry).toBeFocused();
  await expect(entry).toHaveValue("");
  await expect(entryKey).toBeHidden();

  // In the composer it is typed, and so is `m`.
  await page.keyboard.type("rm");
  await expect(entry).toHaveValue("rm");
  await expect(entry).toBeFocused();
  await entry.fill("");

  // From the page, `m` gives the Conversation's composer the caret.
  await column(page, "Journal").getByRole("heading", { name: "Journal" }).click();
  await page.keyboard.press("m");
  await expect(message).toBeFocused();
  await expect(message).toHaveValue("");

  // With a modifier held, it is not taken.
  await column(page, "Journal").getByRole("heading", { name: "Journal" }).click();
  await page.keyboard.press("Alt+r");
  await expect(entry).not.toBeFocused();
  // The same key without it is: the page was there to answer.
  await page.keyboard.press("r");
  await expect(entry).toBeFocused();

  // In the search field each is typed too.
  const field = page.getByRole("searchbox", { name: "Search this Context" });
  await field.click();
  await page.keyboard.type("arm");
  await expect(field).toHaveValue("arm");
  await expect(field).toBeFocused();
  await field.fill("");

  // `a` focuses Attention's heading, which declares it.
  await column(page, "Journal").getByRole("heading", { name: "Journal" }).click();
  await page.keyboard.press("a");
  const heading = column(page, "Attention").getByRole("heading", { name: "Attention" });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAttribute("aria-keyshortcuts", "a");
});

test("in between, the third skip link and a open Attention, whose button names a in its tooltip", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "The in-between width is set on the desktop's Device.");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  const { entry } = composers(page);
  await expect(entry).toBeVisible();
  const open = page.getByRole("banner").getByRole("button", { name: /^Attention/ });
  await expect(open).toHaveAttribute("title", "Attention (a)");
  await expect(open).toHaveAttribute("aria-keyshortcuts", "a");
  const heading = column(page, "Attention").getByRole("heading", { name: "Attention" });

  await column(page, "Journal").getByRole("heading", { name: "Journal" }).click();
  await page.keyboard.press("a");
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(heading).toBeFocused();

  // Open, `/` is not taken, since the search field is under the layer.
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search this Context" })).not.toBeFocused();
  await expect(heading).toBeFocused();

  // `r` closes the layer and gives the Journal's composer the caret.
  await page.keyboard.press("r");
  await expect(column(page, "Attention")).toBeHidden();
  await expect(entry).toBeFocused();

  // The third skip link reads Open Attention, and opens it.
  await page.reload();
  await expect(entry).toBeVisible();
  for (let presses = 0; presses < 3; presses++) await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Open Attention" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(heading).toBeFocused();
});

test("on a phone, the skip link to the Conversation's composer shows the Agent tab and gives it the caret", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone shows one column at a time.");
  await page.goto("/");
  // The screen opens on Attention, the Conversation's tab hidden.
  await expect(column(page, "Attention")).toBeVisible();
  const { message } = composers(page);
  await expect(
    page.getByRole("textbox", { name: /^Message the Agent in /, includeHidden: true }),
  ).toBeAttached();
  await expect(message).toBeHidden();
  // Never a key cap on a phone, where there is no hover.
  const key = page.locator("#conversation .composer-key");
  await expect(key).toBeAttached();
  await expect(key).toBeHidden();

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to the Conversation's composer" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(column(page, "Conversation")).toBeVisible();
  await expect(message).toBeFocused();

  // With a keyboard, `r` shows the Journal's tab and gives its composer the caret.
  await column(page, "Conversation").getByRole("heading", { name: "Conversation" }).click();
  await page.keyboard.press("r");
  const { entry } = composers(page);
  await expect(column(page, "Journal")).toBeVisible();
  await expect(entry).toBeFocused();
  await expect(entry).toHaveValue("");
});

test("on a desktop a works over a Task's page, r works from a Task's round control, and r held types nothing", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "A phone's keys switch tabs first, in a journey of their own.");
  const { id } = await contextOfOwn(page, testInfo, "Keys over a page");
  const title = "Post the parcel";
  await callContextTool(page, id, "record_entry", { words: "Errands", tasks: [{ title }] });
  await page.goto("/");
  const { entry } = composers(page);
  await expect(entry).toBeVisible();
  const attention = column(page, "Attention");

  // From a Task's round control, a checkbox and not a field, `r` gives the composer the caret.
  await attention.getByRole("checkbox", { name: title, exact: true }).focus();
  await page.keyboard.press("r");
  await expect(entry).toBeFocused();
  await expect(entry).toHaveValue("");

  // Held, `r` gives the caret once and its repeats type nothing there.
  await column(page, "Journal").getByRole("heading", { name: "Journal" }).click();
  await page.keyboard.down("r");
  await page.keyboard.down("r");
  await page.keyboard.down("r");
  await page.keyboard.up("r");
  await expect(entry).toBeFocused();
  await expect(entry).toHaveValue("");

  // With a Task's page open over Attention, `a` gives the focus to the page, not to the heading
  // it covers.
  await attention.getByRole("button", { name: title, exact: true }).click();
  const back = attention
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Back to Attention" });
  await expect(back).toBeVisible();
  await column(page, "Journal").getByRole("heading", { name: "Journal" }).click();
  await page.keyboard.press("a");
  await expect(back).toBeFocused();
});
