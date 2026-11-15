import { expect, test } from "@playwright/test";

test("the person records Entries in the Journal's composer and sees them in time order", async ({
  page,
}, testInfo) => {
  // Desktop and phone share one Journal, so each run's words are its own.
  const tag = `${testInfo.project.name}-${Date.now()}`;
  const first = `Called the landlord ${tag}`;
  const second = `Lease renewal needs a signature ${tag}\n  indented, as typed`;

  await page.goto("/");
  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: "New Entry" });

  await composer.fill(first);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByRole("listitem").filter({ hasText: first })).toBeVisible();
  await expect(composer).toHaveValue("");

  await composer.fill(second);
  await composer.press("ControlOrMeta+Enter");
  await expect(journal.getByRole("listitem").filter({ hasText: tag })).toHaveCount(2);

  // What the server kept, read back afresh: the words as typed, oldest first.
  await page.reload();
  const ours = journal.getByRole("listitem").filter({ hasText: tag });
  await expect(ours).toHaveCount(2);
  await expect(ours.nth(0).getByTestId("words")).toHaveText(first);
  await expect(ours.nth(1).getByTestId("words")).toHaveText(second, { useInnerText: true });
});
