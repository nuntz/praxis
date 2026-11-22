import { entryAction, expect, openJournal, test } from "./fixtures.ts";

test("the person searches the Journal, sees the excerpt as typed, opens the Entry and no longer finds it once deleted", async ({
  page,
}, testInfo) => {
  // Every run shares one Journal, in parallel and repeated, so each run's words are its own.
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const words = `Asked about the **storage unit** ${tag}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill(words);
  await journal.getByRole("button", { name: "Record" }).click();
  const entry = journal.getByTestId("entry").filter({ hasText: tag });
  await expect(entry).toBeVisible();

  const search = journal.getByRole("searchbox", { name: "Search this Context" });
  await search.fill(`storage ${tag}`);
  const hit = journal.getByTestId("search-hit");
  await expect(hit).toHaveCount(1);
  // The excerpt is the words as typed, never rendered as Markdown, with what matched marked.
  await expect(hit.getByTestId("search-excerpt")).toHaveText(words);
  await expect(hit.locator("mark")).toHaveText(["storage", tag]);
  await expect(hit.locator("strong")).toHaveCount(0);
  await expect(entry).toBeHidden();

  // Opening it ends the search and brings the Entry into view in the Journal.
  await hit.getByRole("link").click();
  await expect(search).toHaveValue("");
  await expect(entry).toBeFocused();

  await search.fill(tag);
  await expect(hit).toHaveCount(1);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(hit).toHaveCount(0);

  // Sent to the Trash, it is found no more.
  await (await entryAction(entry, "Delete", testInfo)).click();
  await expect(entry).toHaveCount(0);
  await search.fill(tag);
  await expect(journal.getByText("Nothing found")).toBeVisible();
  await expect(hit).toHaveCount(0);
});

test("the person finds an Entry by what it means, though it shares no word with the search", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  // The journeys' meaning index says a molar and a dentist mean alike (journey-worker.ts).
  await composer.fill(`The molar aches again ${tag}`);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByTestId("entry").filter({ hasText: tag })).toBeVisible();

  const search = journal.getByRole("searchbox", { name: "Search this Context" });
  // Other runs' Entries are found too, so this one is picked out by its tag.
  const hit = journal.getByTestId("search-hit").filter({ hasText: tag });
  // Found by meaning shortly after it is saved, not at once: each try asks afresh.
  await expect(async () => {
    await search.fill("");
    await search.fill("dentist");
    await expect(hit).toHaveCount(1, { timeout: 1000 });
  }).toPass();
  // Nothing in it matched the words, so nothing is marked.
  await expect(hit.locator("mark")).toHaveCount(0);
});
