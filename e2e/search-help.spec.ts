import type { TestInfo } from "@playwright/test";
import {
  callContextTool,
  contextOfOwn,
  enterSearch,
  expect,
  holdAnswers,
  onPhone,
  openJournal,
  pickTime,
  test,
} from "./fixtures.ts";

// Search says what to do, and gets out of the way when asked (section 8.4): the clear button clears
// the words alone, Escape or opening a hit ends the search, `/` reaches the field, the empty field
// says what search covers, Nothing found offers to lift each chip in the way, and offline the field
// and chips say why they cannot be used.

const DAY = 24 * 60 * 60 * 1000;

/** The words this run records, its own since other runs share the screen. */
function tagOf(testInfo: TestInfo): string {
  return `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * The Journal opened on a Context of the journey's own, and its search's controls, the search
 * entered unless the journey enters it itself.
 */
async function openSearch(
  page: import("@playwright/test").Page,
  testInfo: TestInfo,
  { entered = true } = {},
) {
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const field = entered
    ? await enterSearch(page)
    : journal.getByRole("searchbox", {
        name: "Search this Context",
        exact: true,
        includeHidden: true,
      });
  const chips = journal.getByRole("group", { name: "Narrow the search" });
  const found = journal.getByRole("region", { name: "Found" });
  const excerpts = found.getByTestId("search-excerpt");
  return { journal, composer, field, chips, found, excerpts };
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
  const { journal, field, chips, found, excerpts } = await openSearch(page, testInfo);
  const clear = journal.getByRole("button", { name: "Clear the words" });
  // On a phone the search is a screen of its own, with a back arrow, until it ends.
  const back = journal.getByRole("button", { name: "Back to the Journal" });
  const screenOwn = (count: number) => expect(back).toHaveCount(onPhone(testInfo) ? count : 0);
  // With no words, there is nothing to clear.
  await expect(clear).toHaveCount(0);

  await pickTime(page, "Last 7 days");
  await field.fill(tag);
  await expect(excerpts).toHaveText([`Just now ${tag}`]);

  // The clear button clears the words alone: the chip stays, and the time chip alone lists
  // everything from its days.
  await clear.click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(clear).toHaveCount(0);
  const setChip = chips.getByRole("button", { name: "Last 7 days, remove" });
  await expect(setChip).toBeVisible();
  await expect(found.getByRole("status")).toHaveText(
    "Everything from the last 7 days, newest first",
  );
  await expect(excerpts).toHaveText([`Just now ${tag}`]);
  await screenOwn(1);
  // Other words, the same narrowing.
  await field.fill(`now ${tag}`);
  await expect(excerpts).toHaveText([`Just now ${tag}`]);

  // Escape ends the search, the words and the chips both, and the chips fold away with it.
  await field.press("Escape");
  await expect(field).toHaveValue("");
  await expect(setChip).toHaveCount(0);
  await expect(chips).toBeHidden();
  await expect(found).toHaveCount(0);
  await expect(journal.getByRole("list", { name: "Entries" })).toBeVisible();
  await screenOwn(0);

  // Pressed on a chip set, with no words, it ends the search too, and the focus the chip held goes
  // to the field, or on a phone to the button that opens the search.
  await pickTime(page, "Last 7 days");
  await expect(setChip).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chips).toBeHidden();
  await expect(
    onPhone(testInfo)
      ? journal.getByRole("button", { name: "Open the search", exact: true })
      : field,
  ).toBeFocused();

  // Opening a hit ends the search, the chips with it.
  await pickTime(page, "Last 7 days");
  await field.fill(tag);
  await screenOwn(1);
  await found.getByRole("link", { name: new RegExp(`Just now ${tag}`) }).click();
  await expect(field).toHaveValue("");
  await expect(setChip).toHaveCount(0);
  await screenOwn(0);
  await expect(chips).toBeHidden();
  await expect(journal.getByTestId("entry").filter({ hasText: `Just now ${tag}` })).toBeFocused();
});

test("the focused empty field says what search covers, and on a desktop / puts the cursor in it but stays a / in the composer", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Slash");
  const { journal, composer, field } = await openSearch(page, testInfo, { entered: false });
  const covers = `Searches the Entries, Tasks, Projects and Persons of ${context.name}, by their words and by what they mean.`;
  const line = journal.getByText(covers);
  await expect(line).toBeHidden();

  await enterSearch(page);
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
  const { journal, field, chips, found, excerpts } = await openSearch(page, testInfo);
  const status = found.getByRole("status");

  // The time chip alone, nothing made in its days: lifting it shows the Journal's Entries again, and
  // on a phone keeps the search's screen, as the field takes the cursor.
  await pickTime(page, "Today");
  await expect(status).toContainText("Nothing found");
  await expect(status).toContainText("Nothing before today is searched.");
  await expect(found.getByRole("button")).toHaveText(["Search any time"]);
  // The offer follows the status, outside it, so its word is not read into the status's sentence,
  // and it is a quiet button, a touch target on a phone.
  await expect(status.getByRole("button")).toHaveCount(0);
  const anyTime = found.getByRole("button", { name: "Search any time" });
  await expect(anyTime).toHaveCSS("text-decoration-line", "underline");
  await expect(anyTime).toHaveCSS("font-weight", "600");
  if (onPhone(testInfo)) {
    expect((await anyTime.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  // Drawn after what it lifts.
  const [keptBox, offerBox] = [
    await status.getByText("Nothing before today is searched.").boundingBox(),
    await anyTime.boundingBox(),
  ];
  if (!keptBox || !offerBox) throw new Error("Both are shown");
  expect(offerBox.y).toBeGreaterThan(keptBox.y);
  expect(offerBox.x).toBe(keptBox.x);
  await found.getByRole("button", { name: "Search any time" }).click();
  await expect(chips.getByRole("button", { name: "Any time" })).toBeVisible();
  await expect(found).toHaveCount(0);
  await expect(journal.getByRole("list", { name: "Entries" })).toBeVisible({
    visible: !onPhone(testInfo),
  });
  await expect(field).toBeFocused();

  await field.fill(tag);
  await expect(excerpts).toHaveText([`Long ago ${tag}`]);
  await expect(status).toHaveText("Found 1");

  // With no chip set, there is nothing to lift: Nothing found only names the words.
  await field.fill(`nowhere${tag}`);
  await expect(status).toHaveText(`Nothing found for “nowhere${tag}”`);
  await expect(found.getByRole("button")).toHaveCount(0);

  await field.fill(tag);
  await pickTime(page, "Last 7 days");
  await expect(status).toContainText(`Nothing found for “${tag}”`);
  await expect(status).toContainText("Nothing older than 7 days is searched.");
  const offer = found.getByRole("button", { name: "Search any time" });
  await offer.click();
  await expect(chips.getByRole("button", { name: "Any time" })).toBeVisible();
  await expect(excerpts).toHaveText([`Long ago ${tag}`]);
  await expect(field).toBeFocused();

  await pickTime(page, "Today");
  await expect(found.getByRole("button", { name: "Search any time" })).toBeVisible();
  await expect(status).toContainText("Nothing before today is searched.");

  // Each chip set has its own offer, in the chips' order, and lifting one keeps the others.
  // Named apart from the words searched, or lifting its chip would find the Project itself.
  const shed = "Shed";
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
  await expect(status).toContainText("Nothing before today is searched.");
  await expect(status).not.toContainText("Only what is in");
  await expect(offers).toHaveText(["Search any time"]);
  await expect(field).toBeFocused();

  // Left showing both offers, so the accessibility check sees them.
  await toShed();
  await expect(offers).toHaveText(["Search any time", "Search every Project"]);
});

test("search says Searching… while its first answer is out, and dims what it shows while a newer one is", async ({
  page,
}, testInfo) => {
  const tag = tagOf(testInfo);
  const context = await contextOfOwn(page, testInfo, "Searching");
  await callContextTool(page, context.id, "record_entry", { words: `Lantern wick ${tag}` });
  const { field, found, excerpts } = await openSearch(page, testInfo);
  const status = found.getByRole("status");

  const held = await holdAnswers(page, "search");
  await field.fill(tag);
  await held.sent({ words: tag });
  await expect(status).toHaveText("Searching…");
  await expect(status.getByText("Searching…")).toHaveCSS("color", await field.evaluate(mutedOf));
  await held.release();
  await expect(status).toHaveText("Found 1");
  await expect(excerpts).toHaveText([`Lantern wick ${tag}`]);

  // Newer words out, what is shown is for the words before: dimmed, and busy, until the answer.
  const shown = found.locator(".search-shown");
  await field.fill(`wick ${tag}`);
  await held.sent({ words: `wick ${tag}` });
  await expect(shown).toHaveAttribute("aria-busy", "true");
  const excerpt = shown.getByTestId("search-excerpt").first();
  const muted = await field.evaluate(mutedOf);
  await expect(excerpt).toHaveCSS("color", muted);
  await held.release();
  await expect(shown).toHaveAttribute("aria-busy", "false");
  await expect(excerpt).not.toHaveCSS("color", muted);
  await expect(status).toHaveText("Found 1");

  // Left with newer words out past the wait, so the accessibility check sees both states.
  await field.fill(`lantern ${tag}`);
  await held.sent({ words: `lantern ${tag}` });
  await expect(status).toHaveText("Searching…");
  await expect(shown).toHaveAttribute("aria-busy", "true");
});

/** The muted colour, as the field's placeholder takes it. */
function mutedOf(field: Element): string {
  return getComputedStyle(field, "::placeholder").color;
}

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
