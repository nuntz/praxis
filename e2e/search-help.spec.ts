import type { TestInfo } from "@playwright/test";
import { callContextTool, contextOfOwn, expect, onPhone, openJournal, test } from "./fixtures.ts";

// Search says what to do, and gets out of the way when asked (section 8.4): the clear button clears
// the words alone, Escape or opening a hit ends the search, `/` reaches the field, the empty field
// says what search covers, Nothing found offers to lift each chip in the way, and offline the field
// and chips say why they cannot be used.

const DAY = 24 * 60 * 60 * 1000;

/** The words this run records, its own since other runs share the screen. */
function tagOf(testInfo: TestInfo): string {
  return `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
}

/** The Journal opened on a Context of the journey's own, and its search's controls. */
async function openSearch(page: import("@playwright/test").Page, testInfo: TestInfo) {
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const field = journal.getByRole("searchbox", { name: "Search this Context" });
  const chips = journal.getByRole("group", { name: "Narrow the search" });
  const found = journal.getByRole("region", { name: "Found" });
  const excerpts = found.getByTestId("search-excerpt");
  const lastWeek = async () => {
    await chips.getByRole("button", { name: "Any time" }).click();
    await journal
      .getByRole("dialog", { name: "Time" })
      .getByRole("button", { name: "Last 7 days" })
      .click();
  };
  return { journal, composer, field, chips, found, excerpts, lastWeek };
}

test("the clear button clears the words and keeps the chips, and Escape or opening a hit ends the search, chips and all", async ({
  page,
}, testInfo) => {
  const tag = tagOf(testInfo);
  const context = await contextOfOwn(page, testInfo, "Ending");
  await callContextTool(page, context.id, "record_entry", { words: `Just now ${tag}` });
  await callContextTool(page, context.id, "record_entry", {
    words: `Long ago ${tag}`,
    made_at: new Date(Date.now() - 20 * DAY).toISOString(),
  });
  const { journal, field, chips, found, excerpts, lastWeek } = await openSearch(page, testInfo);
  const clear = journal.getByRole("button", { name: "Clear the words" });
  // On a phone the search is a screen of its own, with a back arrow, until it ends.
  const back = journal.getByRole("button", { name: "Back to the Journal" });
  const screenOwn = (count: number) => expect(back).toHaveCount(onPhone(testInfo) ? count : 0);
  // With no words, there is nothing to clear.
  await expect(clear).toHaveCount(0);

  await lastWeek();
  await field.fill(tag);
  await expect(excerpts).toHaveText([`Just now ${tag}`]);

  // The clear button clears the words alone: the chip stays, and a time chip alone lists nothing.
  await clear.click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(clear).toHaveCount(0);
  const setChip = chips.getByRole("button", { name: "Last 7 days, remove" });
  await expect(setChip).toBeVisible();
  await expect(found).toHaveCount(0);
  await screenOwn(1);
  // Other words, the same narrowing.
  await field.fill(`now ${tag}`);
  await expect(excerpts).toHaveText([`Just now ${tag}`]);

  // Escape ends the search, the words and the chips both.
  await field.press("Escape");
  await expect(field).toHaveValue("");
  await expect(setChip).toHaveCount(0);
  await expect(chips.getByRole("button", { name: "Any time" })).toBeVisible();
  await expect(found).toHaveCount(0);
  await expect(journal.getByRole("list", { name: "Entries" })).toBeVisible();
  await screenOwn(0);

  // Pressed on a chip set, with no words, it ends the search too.
  await lastWeek();
  await expect(setChip).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chips.getByRole("button", { name: "Any time" })).toBeFocused();

  // Opening a hit ends the search, the chips with it.
  await lastWeek();
  await field.fill(tag);
  await screenOwn(1);
  await found.getByRole("link", { name: new RegExp(`Just now ${tag}`) }).click();
  await expect(field).toHaveValue("");
  await expect(setChip).toHaveCount(0);
  await screenOwn(0);
  await expect(chips.getByRole("button", { name: "Any time" })).toBeVisible();
  await expect(journal.getByTestId("entry").filter({ hasText: `Just now ${tag}` })).toBeFocused();
});

test("the focused empty field says what search covers, and on a desktop / puts the cursor in it but stays a / in the composer", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Slash");
  const { journal, composer, field } = await openSearch(page, testInfo);
  const covers = `Searches the Entries, Tasks, Projects and Persons of ${context.name}, by their words and by what they mean.`;
  const line = journal.getByText(covers);
  await expect(line).toBeHidden();

  await field.focus();
  await expect(line).toBeVisible();
  await expect(field).toHaveAccessibleDescription(covers);
  // Once it holds words, it says it no more.
  await field.fill("a");
  await expect(line).toBeHidden();
  await field.fill("");
  await expect(line).toBeVisible();
  await field.blur();
  await expect(line).toBeHidden();

  if (onPhone(testInfo)) return;
  // `/` from anywhere but a field puts the cursor in the search field, and types nothing there.
  await journal.getByRole("heading", { name: "Journal" }).click();
  await page.keyboard.press("/");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await expect(line).toBeVisible();

  // In the composer, it stays a `/`.
  await composer.fill("either");
  await page.keyboard.press("/");
  await page.keyboard.type("or");
  await expect(composer).toHaveValue("either/or");
  await expect(composer).toBeFocused();

  // In the search field, it stays a `/` too.
  await field.fill("either");
  await page.keyboard.press("/");
  await expect(field).toHaveValue("either/");
});

test("Nothing found names the words and offers to lift each chip set, which reads the list again", async ({
  page,
}, testInfo) => {
  const tag = tagOf(testInfo);
  const context = await contextOfOwn(page, testInfo, "Nothing");
  await callContextTool(page, context.id, "record_entry", {
    words: `Long ago ${tag}`,
    made_at: new Date(Date.now() - 20 * DAY).toISOString(),
  });
  const { journal, field, chips, found, excerpts, lastWeek } = await openSearch(page, testInfo);
  await field.fill(tag);
  await expect(excerpts).toHaveText([`Long ago ${tag}`]);
  const status = found.getByRole("status");
  await expect(status).toHaveText("Found 1");

  // With no chip set, there is nothing to lift: Nothing found only names the words.
  await field.fill(`nowhere${tag}`);
  await expect(status).toHaveText(`Nothing found for “nowhere${tag}”`);
  await expect(found.getByRole("button")).toHaveCount(0);

  await field.fill(tag);
  await lastWeek();
  await expect(status).toContainText(`Nothing found for “${tag}”`);
  await expect(status).toContainText("Nothing older than 7 days is searched.");
  const offer = found.getByRole("button", { name: "Search any time" });
  await offer.click();
  await expect(chips.getByRole("button", { name: "Any time" })).toBeVisible();
  await expect(excerpts).toHaveText([`Long ago ${tag}`]);
  await expect(field).toBeFocused();

  await chips.getByRole("button", { name: "Any time" }).click();
  await journal
    .getByRole("dialog", { name: "Time" })
    .getByRole("button", { name: "Today" })
    .click();
  await expect(found.getByRole("button", { name: "Search any time" })).toBeVisible();
  await expect(status).toContainText("Nothing before today is searched.");

  // Each chip set has its own offer, in the chips' order, and lifting one keeps the others.
  const shed = `Shed ${tag}`;
  await callContextTool(page, context.id, "create_project", { name: shed });
  const toShed = async () => {
    await chips.getByRole("button", { name: "Project", exact: true }).click();
    const picker = journal.getByRole("dialog", { name: "Project" });
    await picker.getByRole("combobox", { name: "Find a Project" }).fill(shed);
    await expect(picker.getByRole("option")).toHaveText([shed]);
    await page.keyboard.press("Enter");
    await expect(chips.getByRole("button", { name: `Project: ${shed}, remove` })).toBeVisible();
  };
  await toShed();
  const offers = found.getByRole("button");
  await expect(offers).toHaveText(["Search any time", "Search every Project"]);
  await expect(status).toContainText(`Only what is in ${shed} is searched.`);
  await found.getByRole("button", { name: "Search every Project" }).click();
  await expect(chips.getByRole("button", { name: "Project", exact: true })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Today, remove" })).toBeVisible();
  await expect(offers).toHaveText(["Search any time"]);
  await expect(field).toBeFocused();

  // Left showing both offers, so the accessibility check sees them.
  await toShed();
  await expect(offers).toHaveText(["Search any time", "Search every Project"]);
});

test("offline, the search field and its chips are shown but cannot be used, and say the search needs the network", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Offline");
  const { journal, field, chips } = await openSearch(page, testInfo);
  const needs = journal.getByText("Search needs the network.");
  await expect(field).toBeEnabled();
  await expect(needs).toHaveCount(0);

  await page.context().setOffline(true);
  await expect(field).toBeDisabled();
  await expect(chips.getByRole("button", { name: "Any time" })).toBeDisabled();
  await expect(needs).toBeVisible();
  await expect(field).toHaveAccessibleDescription("Search needs the network.");

  await page.context().setOffline(false);
  await expect(field).toBeEnabled();
  await expect(chips.getByRole("button", { name: "Any time" })).toBeEnabled();
  await expect(needs).toHaveCount(0);
  await field.fill("anything");
  await expect(journal.getByRole("region", { name: "Found" }).getByRole("status")).toBeVisible();

  // Left offline, so the accessibility check sees the field and chips disabled.
  await page.context().setOffline(true);
  await expect(needs).toBeVisible();
});
