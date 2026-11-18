import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  test,
} from "./fixtures.ts";

// A Held Change (section 4.7): the Agent asked to change the person's words, and only the person's
// tap makes it. The journey makes a Context of its own, so the count it reads is its own.

/** Where the count of what is open to act on is shown: a phone's tab, or the column's heading. */
function count(page: Page, testInfo: TestInfo) {
  return onPhone(testInfo)
    ? page.getByRole("navigation", { name: "Columns" }).getByRole("button", { name: /^Attention/ })
    : page.getByRole("region", { name: "Attention", exact: true }).locator(".peer-header");
}

/** Bring a column into view: on a phone, by its tab. */
async function showColumn(page: Page, testInfo: TestInfo, tab: "Attention" | "Agent") {
  if (!onPhone(testInfo)) return;
  await page
    .getByRole("navigation", { name: "Columns" })
    .getByRole("button", { name: new RegExp(`^${tab}`) })
    .click();
}

test("the Agent's change to the person's words waits for their tap, which makes it", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await makeContext(page, {
    name: `Held ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  const before = `Called the landlord abuot the boiler ${tag}`;
  const after = `Called the landlord about the boiler ${tag}`;
  const { record: entry } = await callContextTool(page, id, "record_entry", { words: before });

  await page.goto("/");
  await showColumn(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Held ${tag}`, exact: true })
    .fill(`Edit ${entry.id} at ${entry.version}: ${after}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  // It waits where the Agent left it, showing the words before and after as typed.
  const left = conversation.getByRole("region", { name: "Held Change: Edit your Entry's words" });
  await expect(left.getByTestId("held-before")).toHaveText(before);
  await expect(left.getByTestId("held-after")).toHaveText(after);
  await expect(count(page, testInfo)).toContainText("1 to act on");

  // Its Entry is unchanged, and marked with a way to it in Attention.
  const { journal } = await openJournal(page, testInfo);
  const shown = journal.getByTestId("entry").filter({ hasText: before });
  await expect(shown.getByTestId("words")).toHaveText(before);
  await shown.getByRole("link", { name: "Held Change for your tap", exact: true }).click();
  const held = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("region", { name: "Held Changes", exact: true })
    .getByRole("region", { name: "Held Change: Edit your Entry's words" });
  await expect(held).toBeFocused();
  await expect(held.getByTestId("held-after")).toHaveText(after);

  // The tap makes it: the Entry's words change, edited by the Agent, and the Held Change is gone.
  const made = page.waitForResponse(/\/tools\/make_held_change$/);
  await held.getByRole("button", { name: "Make this change", exact: true }).click();
  expect((await (await made).json()).ok).toBe(true);
  await expect(held).toHaveCount(0);
  await expect(count(page, testInfo)).not.toContainText("to act on");

  await openJournal(page, testInfo);
  const changed = journal.locator(`[id="entry-${entry.id}"]`);
  await expect(changed.getByTestId("words")).toHaveText(after);
  await expect(
    changed.getByRole("button", { name: "Edited by the Agent", exact: true }),
  ).toBeVisible();
  await expect(changed.getByRole("link", { name: "Held Change for your tap" })).toHaveCount(0);
  await showColumn(page, testInfo, "Agent");
  await expect(left).toHaveCount(0);
});
