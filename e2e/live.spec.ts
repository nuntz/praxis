import { expect, lastShown, makeContext, openJournal, test } from "./fixtures.ts";

test("what changes in one tab shows in another at once, with no reload", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Live ${tag}`,
    time_zone: "UTC",
    accent: "moss",
  });
  // A second tab on the same Context, which only watches: it is told of every change live.
  const watcher = await page.context().newPage();
  for (const tab of [page, watcher]) {
    await lastShown(tab, context.id);
    await tab.goto("/");
  }
  const watched = (await openJournal(watcher, testInfo)).journal;
  const { journal, composer } = await openJournal(page, testInfo);

  const title = `Sign the lease ${tag}`;
  await composer.fill(`Called the landlord ${tag}\n[] ${title}`);
  await journal.getByRole("button", { name: "Record" }).click();
  const entry = watched.getByTestId("entry").filter({ hasText: `Called the landlord ${tag}` });
  await expect(entry.getByRole("checkbox", { name: title })).not.toBeChecked();

  await journal.getByRole("checkbox", { name: title }).check();
  await expect(entry.getByRole("checkbox", { name: title })).toBeChecked();

  // A change to the Context itself, made by the Deployment object, reaches it too.
  await page.request.post("/api/deployment/tools/rename_context", {
    data: { id: context.id, name: `Day job ${tag}` },
  });
  await expect(watcher.getByRole("banner").getByRole("button", { name: /^Context: / })).toHaveText(
    `Context: Day job ${tag}`,
  );

  await watcher.close();
});
