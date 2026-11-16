import { expect, openJournal, test } from "./fixtures.ts";

test("the person records Entries in the Journal's composer and sees them in time order", async ({
  page,
}, testInfo) => {
  // Every run shares one Journal, in parallel and repeated, so each run's words are its own.
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const first = `Called the landlord ${tag}`;
  const second = `Lease renewal needs a signature ${tag}\n  indented, as typed`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);

  await composer.fill(first);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByRole("listitem").filter({ hasText: first })).toBeVisible();
  await expect(composer).toHaveValue("");

  await composer.fill(second);
  await composer.press("ControlOrMeta+Enter");
  await expect(journal.getByRole("listitem").filter({ hasText: tag })).toHaveCount(2);

  // What the server kept, read back afresh: the words as typed, oldest first.
  await page.reload();
  await openJournal(page, testInfo);
  const ours = journal.getByRole("listitem").filter({ hasText: tag });
  await expect(ours).toHaveCount(2);
  await expect(ours.nth(0).getByTestId("words")).toHaveText(first);
  await expect(ours.nth(1).getByTestId("words")).toHaveText(second, { useInnerText: true });
});

test("the person records an Entry with an Inline Task and finishes the Task where it is shown", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const title = `Send the signed lease ${tag}`;
  const words = `Called the landlord ${tag}\n[] ${title}\n- Not a Task ${tag}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill(words);
  await journal.getByRole("button", { name: "Record" }).click();

  // The marked line makes one Task, shown with its Entry; the list item makes none.
  const entry = journal.getByTestId("entry").filter({ hasText: `Called the landlord ${tag}` });
  await expect(entry.getByRole("checkbox")).toHaveCount(1);
  const task = entry.getByRole("checkbox", { name: title });
  await expect(task).not.toBeChecked();
  // The marker stays in the words, as typed.
  await expect(entry.getByTestId("words")).toHaveText(words, { useInnerText: true });

  await task.check();
  await expect(task).toBeChecked();

  // What the server kept, read back afresh: the Task is Finished, and still hangs off its Entry.
  await page.reload();
  await openJournal(page, testInfo);
  await expect(entry.getByRole("checkbox", { name: title })).toBeChecked();
  await expect(entry.getByTestId("words")).toHaveText(words, { useInnerText: true });
});
