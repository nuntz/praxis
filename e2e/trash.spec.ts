import type { Page } from "@playwright/test";
import {
  callContextTool,
  closeSettings,
  contextOfOwn,
  entryAction,
  expect,
  lastShown,
  makeContext,
  openJournal,
  openSettings,
  showSection,
  test,
} from "./fixtures.ts";

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
  await (await entryAction(deleted, "Delete", testInfo)).click();
  expect((await (await deleting).json()).ok).toBe(true);
  await expect(deleted).toHaveCount(0);
  await expect(journal.getByRole("checkbox", { name: title })).toHaveCount(0);
  // A link to what went is kept, dormant, and the words that hold it never change.
  await expect(linking.getByRole("listitem").filter({ hasText: `#${title}` })).toHaveText(
    `#${title}, deleted`,
  );

  const trash = await openSettings(page, "Trash");
  const item = trash.getByTestId("trash-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(`Entry ${words}`);
  await expect(item).toContainText(`With it: Task ${title}`);
  await expect(item.getByText(/^Deleted .+ · Stays until .+ 20\d\d$/)).toBeVisible();
  await expect(trash.getByText(/^Praxis cannot reach a file you downloaded/)).toBeVisible();
  // What the Agent quoted stays in the Conversation until the person clears it (section 3.8).
  await expect(
    trash.getByText(
      /The Conversation keeps what the Agent quoted of a record removed here until you clear it, in this Context's settings\.$/,
    ),
  ).toBeVisible();

  const restoring = page.waitForResponse(/\/tools\/restore$/);
  await item.getByRole("button", { name: "Restore", exact: true }).click();
  expect((await (await restoring).json()).ok).toBe(true);
  await expect(trash.getByRole("status")).toHaveText(
    `“${words}” and 1 Task are back in the Journal.`,
  );
  await expect(trash.getByText("The Trash is empty.")).toBeVisible();

  // Back together: the Entry with its Task, and the link to it no longer deleted.
  await closeSettings(page);
  await openJournal(page, testInfo);
  await expect(deleted).toHaveCount(1);
  await expect(deleted.getByRole("checkbox", { name: title, exact: true })).toBeVisible();
  await expect(linking.getByRole("listitem").filter({ hasText: `#${title}` })).toHaveText(
    `#${title}`,
  );
});

test("an Entry deleted in the Journal is said with Restore, which has the focus and brings it back with its Task", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await makeContext(page, {
    name: `Hallway ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  const [summary, title] = [`Paint the hall ${tag}`, `Buy paint ${tag}`];
  const { record: entry } = await callContextTool(page, id, "record_entry", {
    words: `${summary}\nTwo coats, the second after a day`,
    tasks: [{ title }],
  });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const shown = journal.locator(`[id="entry-${entry.id}"]`);
  await expect(shown.getByRole("checkbox", { name: title, exact: true })).toBeVisible();
  // The status line is in the page before anything is said, and only its words change, so a
  // screen reader announces each.
  const line = journal.getByRole("status");
  await expect(line).toHaveText("");
  const element = await line.elementHandle();
  const stillThere = () => element?.evaluate((each) => each.isConnected);

  const deleting = page.waitForResponse(/\/tools\/delete_entry$/);
  await (await entryAction(shown, "Delete", testInfo)).click();
  expect((await (await deleting).json()).ok).toBe(true);
  await expect(shown).toHaveCount(0);
  // Said as a Follow-up names it, by its summary, with the way back, which has the focus.
  await expect(line).toHaveText(`“${summary}” is in the Trash. Restore`);
  const restore = line.getByRole("button", { name: "Restore", exact: true });
  await expect(restore).toBeFocused();
  expect(await stillThere()).toBe(true);

  // With no network it is refused as Attention's Restore is, and stays said.
  await page.context().setOffline(true);
  await page.keyboard.press("Enter");
  await expect(journal.getByRole("alert")).toHaveText(
    "Praxis could not be reached: this needs the network.",
  );
  await expect(line).toHaveText(`“${summary}” is in the Trash. Restore`);
  await expect(shown).toHaveCount(0);
  await page.context().setOffline(false);

  const restoring = page.waitForResponse(/\/tools\/restore$/);
  await restore.click();
  expect((await (await restoring).json()).ok).toBe(true);
  // Back with what went with it, and the focus on it, as the line it was said on empties.
  await expect(shown.getByRole("checkbox", { name: title, exact: true })).toBeVisible();
  await expect(shown).toBeFocused();
  await expect(line).toHaveText("");
  await expect(journal.getByRole("alert")).toHaveCount(0);
  expect(await stillThere()).toBe(true);

  // Deleted again, the journey ends on the line saying so, as the accessibility check sees it.
  await (await entryAction(shown, "Delete", testInfo)).click();
  await expect(restore).toBeFocused();
});

/** Record an Entry with these words and send it to the Trash, by call. */
async function trashed(page: Page, id: string, words: string, titles: string[] = []) {
  const { record } = await callContextTool(page, id, "record_entry", {
    words,
    tasks: titles.map((title) => ({ title })),
  });
  return (await callContextTool(page, id, "delete_entry", { id: record.id })).record;
}

/** The record ids in the Context's Trash, newest delete first, by call. */
async function inTheTrash(page: Page, id: string): Promise<string[]> {
  const { items } = await callContextTool(page, id, "list_trash", {});
  return items.map((item: { record: { id: string } }) => item.record.id);
}

test("Restore by keyboard says what came back where it stood, and the focus goes to it", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await contextOfOwn(page, testInfo, "Restoring");
  const [older, newer] = [`Repaint the hallway ${tag}`, `Fix the gate ${tag}`];
  await trashed(page, id, older, [`Buy paint ${tag}`, `Sand the walls ${tag}`]);
  await trashed(page, id, newer);

  await page.goto("/");
  const trash = await openSettings(page, "Trash");
  const item = trash.getByTestId("trash-item").filter({ hasText: older });
  const restore = item.getByRole("button", { name: "Restore", exact: true });
  // Each act is told apart by what it acts on, and none is ever disabled.
  await expect(restore).toHaveAccessibleDescription(`Entry ${older}`);
  await expect(item.getByRole("button", { name: "Remove for good" })).toHaveAccessibleDescription(
    `Entry ${older}`,
  );

  await restore.focus();
  const restoring = page.waitForResponse(/\/tools\/restore$/);
  await page.keyboard.press("Enter");
  expect((await (await restoring).json()).ok).toBe(true);
  const said = trash.getByRole("status");
  await expect(said).toHaveText(`“${older}” and 2 Tasks are back in the Journal.`);
  await expect(said).toBeFocused();
  await expect(item).toHaveCount(0);
  await expect(trash.getByTestId("trash-item")).toHaveCount(1);
  await expect(trash.locator("button:disabled")).toHaveCount(0);
});

test("Remove for good waits until the Trash is left, and Keep it takes it back", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await contextOfOwn(page, testInfo, "Removing");
  const [kept, removed] = [`Kept after all ${tag}`, `Gone for good ${tag}`];
  const keptItem = await trashed(page, id, kept);
  const removedItem = await trashed(page, id, removed);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (/\/tools\/(remove_for_good|empty_trash)$/.test(request.url())) sent.push(request.url());
  });

  await page.goto("/");
  const trash = await openSettings(page, "Trash");
  const row = (words: string) => trash.getByTestId("trash-item").filter({ hasText: words });

  // Marked, it stays, says so, and the focus goes to the way back.
  await row(kept).getByRole("button", { name: "Remove for good" }).click();
  await expect(row(kept)).toContainText("Removed for good when you leave the Trash");
  const keep = row(kept).getByRole("button", { name: "Keep it", exact: true });
  await expect(keep).toBeFocused();
  await keep.click();
  await expect(row(kept).getByRole("button", { name: "Remove for good" })).toBeFocused();
  await expect(row(kept)).not.toContainText("Removed for good when you leave the Trash");

  await row(removed).getByRole("button", { name: "Remove for good" }).click();
  await expect(row(removed).getByRole("button", { name: "Keep it", exact: true })).toBeFocused();
  expect(sent).toEqual([]);
  expect(await inTheTrash(page, id)).toEqual([removedItem.record.id, keptItem.record.id]);

  // Another section opened, the one marked is sent, and the one kept stays.
  const removing = page.waitForResponse(/\/tools\/remove_for_good$/);
  await showSection(page, "General");
  expect((await (await removing).json()).ok).toBe(true);
  expect(sent).toHaveLength(1);
  expect(await inTheTrash(page, id)).toEqual([keptItem.record.id]);

  // Marked again, the journey ends on the mark, as the accessibility check sees it.
  const again = await showSection(page, "Trash");
  await expect(again.getByTestId("trash-item")).toHaveCount(1);
  await row(kept).getByRole("button", { name: "Remove for good" }).click();
  await expect(row(kept).getByRole("button", { name: "Keep it", exact: true })).toBeFocused();
});

test("Empty the Trash empties it as shown when the Trash is left, keeps what was deleted after, and removes nothing with no network", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await contextOfOwn(page, testInfo, "Emptying");
  await trashed(page, id, `First ${tag}`);
  await trashed(page, id, `Second ${tag}`);

  await page.goto("/");
  const trash = await openSettings(page, "Trash");
  const items = trash.getByTestId("trash-item");
  await expect(items).toHaveCount(2);
  await trash.getByRole("button", { name: "Empty the Trash" }).click();
  await expect(trash.getByRole("button", { name: "Keep them", exact: true })).toBeFocused();
  await expect(items.filter({ hasText: "Removed for good when you leave the Trash" })).toHaveCount(
    2,
  );

  // Deleted after, on another Device, it shows unmarked, and stays.
  const later = await trashed(page, id, `Deleted after ${tag}`);
  const laterRow = items.filter({ hasText: `Deleted after ${tag}` });
  // Marked by itself meanwhile, it has its own Keep it, which takes the focus and the mark back.
  await laterRow.getByRole("button", { name: "Remove for good" }).click();
  const keepLater = laterRow.getByRole("button", { name: "Keep it", exact: true });
  await expect(keepLater).toBeFocused();
  await keepLater.click();
  await expect(laterRow.getByRole("button", { name: "Remove for good" })).toBeFocused();

  const emptying = page.waitForResponse(/\/tools\/empty_trash$/);
  await closeSettings(page);
  const emptied = await (await emptying).json();
  expect(emptied).toMatchObject({ ok: true, value: { record: { items: 2 } } });
  expect(await inTheTrash(page, id)).toEqual([later.record.id]);

  // With no network, leaving removes nothing, and the screen says so.
  const again = await openSettings(page, "Trash");
  await again.getByRole("button", { name: "Remove for good" }).click();
  await page.context().setOffline(true);
  await closeSettings(page);
  await expect(page.getByRole("alert")).toHaveText(
    "Praxis could not be reached: nothing was removed for good.",
  );
  await page.context().setOffline(false);
  expect(await inTheTrash(page, id)).toEqual([later.record.id]);
});

test("Show earlier reaches past the newest 50, and Empty the Trash empties what was never read, after Keep them takes it back once", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await contextOfOwn(page, testInfo, "Paging");
  // The oldest first, then 50 more, each its own item.
  await trashed(page, id, `Oldest ${tag}`);
  for (let batch = 0; batch < 5; batch++) {
    await Promise.all(
      Array.from({ length: 10 }, (_, n) => trashed(page, id, `Item ${batch * 10 + n} ${tag}`)),
    );
  }

  await page.goto("/");
  const trash = await openSettings(page, "Trash");
  const items = trash.getByTestId("trash-item");
  await expect(items).toHaveCount(50);
  await expect(items.filter({ hasText: `Oldest ${tag}` })).toHaveCount(0);
  const earlier = trash.getByRole("button", { name: "Show earlier", exact: true });
  await earlier.click();
  await expect(items).toHaveCount(51);
  await expect(items.last()).toContainText(`Oldest ${tag}`);
  await expect(earlier).toHaveCount(0);

  // Emptying, then Keep them, takes every mark back, and the focus goes back to Empty the Trash.
  const empty = trash.getByRole("button", { name: "Empty the Trash", exact: true });
  await empty.click();
  const keepThem = trash.getByRole("button", { name: "Keep them", exact: true });
  await expect(keepThem).toBeFocused();
  await expect(keepThem).toHaveAccessibleDescription(
    "Everything in the Trash now is removed for good when you leave the Trash.",
  );
  await keepThem.click();
  await expect(empty).toBeFocused();
  await expect(items.filter({ hasText: "Removed for good when you leave the Trash" })).toHaveCount(
    0,
  );

  // Emptied as the Trash is left, it takes the oldest too.
  await empty.click();
  const emptying = page.waitForResponse(/\/tools\/empty_trash$/);
  await showSection(page, "General");
  expect(await (await emptying).json()).toMatchObject({
    ok: true,
    value: { record: { items: 51 } },
  });
  expect(await inTheTrash(page, id)).toEqual([]);

  // One more deleted and emptied, the journey ends on the Trash marked to be emptied.
  await trashed(page, id, `Last ${tag}`);
  const again = await showSection(page, "Trash");
  await again.getByRole("button", { name: "Empty the Trash", exact: true }).click();
  await expect(again.getByRole("button", { name: "Keep them", exact: true })).toBeFocused();
});
