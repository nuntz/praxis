import { callContextTool, expect, lastShown, makeContext, openJournal, test } from "./fixtures.ts";

// The person marks an Entry standing from the Journal, sees the full list for the Context in its
// settings, and unmarks it there (sections 5.5 and 8.6). A Context of the journey's own, so its
// Standing Entries are its own.

test("the person marks an Entry standing, sees it with the Standing Entries, and unmarks it", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await makeContext(page, {
    name: `Habits ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  const [kept, other] = [`No meetings before ten ${tag}`, `Bought a kettle ${tag}`];
  for (const words of [kept, other]) await callContextTool(page, id, "record_entry", { words });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const entry = journal.getByTestId("entry").filter({ hasText: kept });
  const toggle = entry.getByRole("button", { name: "Standing", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  const marking = page.waitForResponse(/\/tools\/mark_standing$/);
  await toggle.click();
  expect((await (await marking).json()).ok).toBe(true);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Settings" }).click();
  const standing = page.getByRole("region", { name: "Standing Entries", exact: true });
  const listed = standing.getByTestId("standing-entry");
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText(kept);
  await expect(standing.getByTestId("standing-size")).toHaveText(
    `${kept.length} of 10,000 characters`,
  );

  const unmarking = page.waitForResponse(/\/tools\/unmark_standing$/);
  await listed.getByRole("button", { name: "Unmark", exact: true }).click();
  expect((await (await unmarking).json()).ok).toBe(true);
  await expect(standing.getByText("No Entry is standing.")).toBeVisible();

  // The Journal hears of it on the live channel: the Entry stays, no longer standing.
  await page.getByRole("button", { name: "Settings" }).click();
  await openJournal(page, testInfo);
  await expect(entry).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
