import { callContextTool, expect, lastShown, makeContext, openJournal, test } from "./fixtures.ts";

// Deleting sends a record to the Trash, with what cannot exist without it, and restoring brings
// it all back (sections 3.8 and 8.6). A Context of the journey's own, so its Trash is its own.

test("the person deletes an Entry, sees it and its Task in the Trash, and restores it", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await makeContext(page, {
    name: `Painting ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  const [words, title, about] = [`Paint the hall ${tag}`, `Buy paint ${tag}`, `Colours ${tag}`];
  const { record: entry } = await callContextTool(page, id, "record_entry", {
    words,
    tasks: [{ title }],
  });
  await callContextTool(page, id, "record_entry", {
    words: about,
    links: [{ to: { kind: "task", id: entry.tasks[0].id } }],
  });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const deleted = journal.getByTestId("entry").filter({ hasText: words });
  const linking = journal.getByTestId("entry").filter({ hasText: about });
  await expect(linking.getByRole("listitem").filter({ hasText: `#${title}` })).toHaveText(
    `#${title}`,
  );

  // No asking first: what is deleted is put back from the Trash.
  const deleting = page.waitForResponse(/\/tools\/delete_entry$/);
  await deleted.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await (await deleting).json()).ok).toBe(true);
  await expect(deleted).toHaveCount(0);
  await expect(journal.getByRole("checkbox", { name: title })).toHaveCount(0);
  // A link to what went is kept, dormant, and the words that hold it never change.
  await expect(linking.getByRole("listitem").filter({ hasText: `#${title}` })).toHaveText(
    `#${title}, deleted`,
  );

  await page.getByRole("button", { name: "Settings" }).click();
  const trash = page.getByRole("region", { name: "Trash", exact: true });
  const item = trash.getByTestId("trash-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(`Entry ${words}`);
  await expect(item).toContainText(`With it: Task ${title}`);
  await expect(item.getByText(/^Removed for good on /)).toBeVisible();
  await expect(trash.getByText(/^Praxis cannot reach a file you downloaded/)).toBeVisible();

  const restoring = page.waitForResponse(/\/tools\/restore$/);
  await item.getByRole("button", { name: "Restore", exact: true }).click();
  expect((await (await restoring).json()).ok).toBe(true);
  await expect(trash.getByText("The Trash is empty.")).toBeVisible();

  // Back together: the Entry with its Task, and the link to it no longer deleted.
  await page.getByRole("button", { name: "Settings" }).click();
  await openJournal(page, testInfo);
  await expect(deleted).toHaveCount(1);
  await expect(deleted.getByRole("checkbox", { name: title, exact: true })).toBeVisible();
  await expect(linking.getByRole("listitem").filter({ hasText: `#${title}` })).toHaveText(
    `#${title}`,
  );
});
