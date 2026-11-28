import {
  callContextTool,
  contextOfOwn,
  entryAction,
  expect,
  openJournal,
  test,
} from "./fixtures.ts";

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
  // Found by its id from here on, since its words change and a Follow-up names them.
  const entry = journal.locator(`[id="${await recorded.getAttribute("id")}"]`);
  await expect(entry.getByRole("button", { name: /^Edited/ })).toHaveCount(0);

  // The Entry's page shows the words as typed, and a marked line they gain makes a Task.
  await (await entryAction(entry, "Edit", testInfo)).click();
  const opened = page.getByRole("dialog", { name: /^The Entry of / });
  const editor = opened.getByRole("textbox", { name: "The Entry's words", exact: true });
  await expect(editor).toHaveValue(first);
  await editor.fill(edited);
  const saved = page.waitForResponse((response) => response.url().endsWith("/tools/edit_entry"));
  await opened.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  await expect(opened).toHaveCount(0);
  const shown = entry.getByTestId("words");
  await expect(shown.getByText(`${first}, far too high`, { exact: true })).toBeVisible();
  await expect(shown.getByText(`[] Ask for another quote ${tag}`, { exact: true })).toBeVisible();
  await expect(entry.getByRole("checkbox", { name: `Ask for another quote ${tag}` })).toBeVisible();

  // The edited mark opens the Versions, each headed by whose change replaced its words and
  // compared from the current words to its own: what restoring it takes away is struck.
  await entry.getByRole("button", { name: "Edited", exact: true }).click();
  const versions = entry.getByRole("region", { name: "Versions" });
  await expect(versions.getByTestId("version")).toHaveCount(1);
  await expect(versions.getByRole("heading", { name: /^Before your change, / })).toBeVisible();
  const comparison = versions.getByTestId("comparison");
  await expect(comparison.locator("del")).toHaveText([
    `removed: , far too high\n[] Ask for another quote ${tag}`,
  ]);
  await expect(comparison.locator("ins")).toHaveCount(0);
  const restore = versions.getByRole("button", { name: "Restore this Version" });
  await expect(restore).toHaveAccessibleDescription(/^Before your change, /);

  // Restoring is a new change: the words it replaced become a Version, and the Task stays. What
  // it did is said under the Entry, which takes the focus from the Restore pressed.
  const restored = page.waitForResponse((response) =>
    response.url().endsWith("/tools/restore_entry_version"),
  );
  await restore.click();
  await restored;
  await expect(entry.getByTestId("words")).toHaveText(first);
  const said = entry.getByRole("status");
  await expect(said).toHaveText(/^Words restored to those before your change at \S/);
  await expect(said).toBeFocused();
  await expect(versions.getByTestId("version")).toHaveCount(2);
  await expect(entry.getByRole("checkbox", { name: `Ask for another quote ${tag}` })).toBeVisible();
  // The Version whose words are the current ones says so, in place of its Restore.
  await expect(versions.getByTestId("version").nth(1)).toContainText("These are the words now");
  await expect(versions.getByRole("button", { name: "Restore this Version" })).toHaveCount(1);

  // A Follow-up continues it, and the Journal shows the Entry with its Follow-ups.
  const second = `Second quote came ${tag}`;
  await (await entryAction(entry, "Follow up", testInfo)).click();
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

test("an Entry with many Versions shows the newest five, folds what is unchanged, and says when it needs the network", async ({
  page,
}, testInfo) => {
  const { id } = await contextOfOwn(page, testInfo, "Versions");
  // Twelve lines every edit leaves, between the first, which each changes, and the last.
  const middle = Array.from({ length: 12 }, (_, line) => `Clause ${line + 1}\n`).join("");
  const wordsAt = (rent: number) => `Rent is ${rent}\n${middle}Signed`;
  let { record: entry } = await callContextTool(page, id, "record_entry", { words: wordsAt(900) });
  for (const rent of [910, 920, 930, 940, 950, 960, 970]) {
    ({ record: entry } = await callContextTool(page, id, "edit_entry", {
      id: entry.id,
      version: entry.version,
      words: wordsAt(rent),
    }));
  }

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const shown = journal.locator(`[id="entry-${entry.id}"]`);
  await expect(shown.getByTestId("words")).toContainText("Rent is 970");

  // With no network, the box itself says the Versions need it, and reads them once it is back.
  await page.context().setOffline(true);
  await shown.getByRole("button", { name: "Edited", exact: true }).click();
  const versions = shown.getByRole("region", { name: "Versions" });
  await expect(versions.getByText("Versions need the network.", { exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await expect(versions.getByText("Versions need the network.")).toHaveCount(0);

  // The newest five first, then five more a press.
  await expect(versions.getByTestId("version")).toHaveCount(5);
  await versions.getByRole("button", { name: "Show earlier Versions", exact: true }).click();
  await expect(versions.getByTestId("version")).toHaveCount(7);
  await expect(versions.getByRole("button", { name: "Show earlier Versions" })).toHaveCount(0);

  // The newest Version, from the current words to its own: what comes is the 960, and the twelve
  // lines and the last, all unchanged, are folded, opening in place.
  const newest = versions.getByTestId("version").first();
  await expect(newest.locator("del")).toHaveText(["removed: 970"]);
  await expect(newest.locator("ins")).toHaveText(["added: 960"]);
  const fold = newest.getByRole("button", { name: "… 13 lines unchanged …", exact: true });
  await fold.click();
  await expect(fold).toHaveCount(0);
  await expect(newest.getByTestId("comparison")).toContainText("Clause 12");

  // Restoring it says so under the Entry, with the focus, and the Version whose words are now the
  // Entry's says so in place of its Restore.
  const restored = page.waitForResponse(/\/tools\/restore_entry_version$/);
  await newest.getByRole("button", { name: "Restore this Version", exact: true }).click();
  await restored;
  await expect(shown.getByTestId("words")).toContainText("Rent is 960");
  const said = shown.getByRole("status");
  await expect(said).toHaveText(/^Words restored to those before your change at \S/);
  await expect(said).toBeFocused();
  await expect(
    versions.getByTestId("version").filter({ hasText: "These are the words now" }),
  ).toHaveCount(1);
});

test("with no network an Entry's Versions say so in their own box", async ({ page }, testInfo) => {
  const { id } = await contextOfOwn(page, testInfo, "Versions offline");
  const { record } = await callContextTool(page, id, "record_entry", { words: "Lease signed" });
  await callContextTool(page, id, "edit_entry", {
    id: record.id,
    version: record.version,
    words: "Lease signed and sent",
  });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const shown = journal.locator(`[id="entry-${record.id}"]`);
  await expect(shown.getByTestId("words")).toHaveText("Lease signed and sent");
  await page.context().setOffline(true);
  await shown.getByRole("button", { name: "Edited", exact: true }).click();
  await expect(
    shown
      .getByRole("region", { name: "Versions" })
      .getByText("Versions need the network.", { exact: true }),
  ).toBeVisible();
});
