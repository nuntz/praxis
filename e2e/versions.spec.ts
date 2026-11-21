import { expect, openJournal, test } from "./fixtures.ts";

test("the person edits an Entry, restores an earlier Version and records a Follow-up to it", async ({
  page,
}, testInfo) => {
  // Every run shares one Journal, in parallel and repeated, so each run's words are its own.
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const first = `Quote from the roofer ${tag}`;
  const edited = `Quote from the roofer ${tag}, far too high\n[] Ask for another quote ${tag}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill(first);
  await composer.press("ControlOrMeta+Enter");
  const recorded = journal
    .getByTestId("entry")
    .filter({ has: page.getByTestId("words").getByText(first, { exact: true }) });
  await expect(recorded).toHaveCount(1);
  // Found by its id from here on, since editing it hides its words and a Follow-up names them.
  const entry = journal.locator(`[id="${await recorded.getAttribute("id")}"]`);
  await expect(entry.getByRole("button", { name: /^Edited/ })).toHaveCount(0);

  // The editor shows the words as typed, and a marked line it adds makes a Task.
  await entry.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = entry.getByRole("textbox", { name: "The Entry's words", exact: true });
  await expect(editor).toHaveValue(first);
  await editor.fill(edited);
  const saved = page.waitForResponse((response) => response.url().endsWith("/tools/edit_entry"));
  await entry.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  const shown = entry.getByTestId("words");
  await expect(shown.getByText(`${first}, far too high`, { exact: true })).toBeVisible();
  await expect(shown.getByText(`[] Ask for another quote ${tag}`, { exact: true })).toBeVisible();
  await expect(entry.getByRole("checkbox", { name: `Ask for another quote ${tag}` })).toBeVisible();

  // The edited mark opens the Versions, each compared against the current words.
  await entry.getByRole("button", { name: "Edited", exact: true }).click();
  const versions = entry.getByRole("region", { name: "Versions" });
  await expect(versions.getByTestId("version")).toHaveCount(1);
  const comparison = versions.getByTestId("comparison");
  await expect(comparison).toHaveText(`${first}, far too high\n[] Ask for another quote ${tag}`, {
    useInnerText: true,
  });
  await expect(comparison.locator("ins")).toHaveText([
    `, far too high\n[] Ask for another quote ${tag}`,
  ]);

  // Restoring is a new change: the words it replaced become a Version, and the Task stays.
  const restored = page.waitForResponse((response) =>
    response.url().endsWith("/tools/restore_entry_version"),
  );
  await versions.getByRole("button", { name: "Restore this Version" }).click();
  await restored;
  await expect(entry.getByTestId("words")).toHaveText(first);
  await expect(versions.getByTestId("version")).toHaveCount(2);
  await expect(entry.getByRole("checkbox", { name: `Ask for another quote ${tag}` })).toBeVisible();

  // A Follow-up continues it, and the Journal shows the Entry with its Follow-ups.
  const second = `Second quote came ${tag}`;
  await entry.getByRole("button", { name: "Follow up", exact: true }).click();
  await expect(journal.getByText(`Following up “${first}”`)).toBeVisible();
  await composer.fill(second);
  await composer.press("ControlOrMeta+Enter");
  const followUp = journal
    .getByTestId("entry")
    .filter({ has: page.getByTestId("words").getByText(second, { exact: true }) });
  await expect(followUp.getByRole("link", { name: `“${first}”` })).toBeVisible();
  await expect(
    entry.getByRole("list", { name: "Follow-ups" }).getByRole("link", { name: second }),
  ).toBeVisible();
  await expect(journal.getByText(/^Following up/)).toHaveCount(0);

  // What the server kept, read back afresh.
  await page.reload();
  await openJournal(page, testInfo);
  await expect(entry.getByTestId("words")).toHaveText(first);
  await expect(entry.getByRole("button", { name: "Edited", exact: true })).toBeVisible();
  await expect(
    entry.getByRole("list", { name: "Follow-ups" }).getByRole("link", { name: second }),
  ).toBeVisible();
  await expect(followUp.getByRole("link", { name: `“${first}”` })).toBeVisible();
});
