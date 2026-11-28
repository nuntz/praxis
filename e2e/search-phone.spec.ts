import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  contextOfOwn,
  enterSearch,
  expect,
  onPhone,
  openJournal,
  pickTime,
  test,
} from "./fixtures.ts";

// On a phone, search waits behind a button beside the Journal's title, and opens as a screen of its
// own in the Journal tab: a back arrow beside the field, the chips in one row that scrolls sideways,
// what is found and the tab bar, with no composer; back returns to the Journal where it was. On a
// desktop its field is in the Journal's header, its chips under it only while it is in use, and
// the composer stays below what is found (section 8.4).

const HOUR = 60 * 60 * 1000;

/** A Project whose name, on its chip, takes the row of chips past a phone's width. */
const ROOFING = "Battens, flashing and gutters for the outbuilding";

/** A Context of the journey's own, with a Journal longer than the screen and a Task in it. */
async function longJournal(page: Page, testInfo: TestInfo) {
  const context = await contextOfOwn(page, testInfo, "Phone search");
  for (let note = 1; note <= 16; note += 1) {
    await callContextTool(page, context.id, "record_entry", {
      words: `Note ${note} on the shed roof, which leaks again after the storm last night, and the gutter with it.`,
      made_at: new Date(Date.now() - (20 - note) * HOUR).toISOString(),
    });
  }
  const { record } = await callContextTool(page, context.id, "record_entry", {
    words: "The shed needs a new felt roof",
    tasks: [{ title: "Order felt for the shed roof" }],
  });
  const roofing = await callContextTool(page, context.id, "create_project", { name: ROOFING });
  await callContextTool(page, context.id, "create_project", { name: "Shed foundations" });
  await callContextTool(page, context.id, "move_task", {
    id: (record.tasks as { id: string }[])[0]?.id,
    project_id: roofing.record.id,
  });
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  // Found hidden too, since on a phone the field is hidden until the search is opened.
  const field = journal.getByRole("searchbox", {
    name: "Search this Context",
    exact: true,
    includeHidden: true,
  });
  const chips = journal.getByRole("group", { name: "Narrow the search" });
  const found = journal.getByRole("region", { name: "Found" });
  return { journal, composer, field, chips, found };
}

/** How tall something is shown, in pixels. */
async function heightOf(shown: Locator): Promise<number> {
  const box = await shown.boundingBox();
  if (!box) throw new Error("What is shown has a box");
  return box.height;
}

/** The colour something is drawn on. */
function backgroundOf(shown: Locator): Promise<string> {
  return shown.evaluate((element) => getComputedStyle(element).backgroundColor);
}

/** Pressed at the left end of its pill, by the search icon, the field takes the caret. */
async function pressFieldEnd(page: Page, field: Locator) {
  // The input's parent is the pill drawn round it.
  const pill = field.locator("..");
  const box = await pill.boundingBox();
  if (!box) throw new Error("The field's pill is shown");
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
}

/** Each of these at least a touch target's 44px tall. */
async function expectTappable(shown: Locator) {
  for (const each of await shown.all()) {
    expect(await heightOf(each)).toBeGreaterThanOrEqual(44);
  }
}

test("on a phone, search is a screen of its own whose back arrow returns to the Journal where it was", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone gives search a screen of its own.");
  const { journal, composer, field, chips, found } = await longJournal(page, testInfo);
  const heading = journal.getByRole("heading", { name: "Journal", exact: true });
  const tabs = page.getByRole("navigation", { name: "Columns" });
  const back = journal.getByRole("button", { name: "Back to the Journal" });
  const open = journal.getByRole("button", { name: "Open the search", exact: true });
  await expect(composer).toBeVisible();
  await expect(back).toHaveCount(0);
  // The composer's own `#` picker offers its choices as touch targets too.
  await composer.fill("#Battens");
  const offered = journal.getByRole("listbox", { name: "Tasks and Projects" }).getByRole("option");
  await expect(offered.first()).toBeVisible();
  await expectTappable(offered);
  await composer.fill("");
  // Until it is opened, the search is a button beside the Journal's title, and its field is hidden.
  await expect(open).toBeVisible();
  await expect(field).toBeHidden();
  expect(await heightOf(open)).toBeGreaterThanOrEqual(44);
  const [openBox, headingBox] = [await open.boundingBox(), await heading.boundingBox()];
  if (!openBox || !headingBox) throw new Error("Both are shown");
  expect(
    Math.abs(openBox.y + openBox.height / 2 - (headingBox.y + headingBox.height / 2)),
  ).toBeLessThan(8);

  // Scrolled back from the newest, to an earlier Entry.
  const earlier = journal.getByTestId("entry").filter({ hasText: "Note 5 on" });
  await earlier.scrollIntoViewIfNeeded();
  const left = await earlier.boundingBox();
  // An Entry is a surface card, which what is found is drawn on too.
  const card = await backgroundOf(earlier);

  // Opening the search gives it the screen, the caret in its field: the back arrow beside the field,
  // the tab bar kept, and neither the Journal's title nor its composer.
  await open.click();
  await expect(field).toBeFocused();
  await expect(back).toBeVisible();
  await expect(heading).toBeHidden();
  await expect(composer).toBeHidden();
  await expect(tabs).toBeVisible();
  await expect(journal.getByTestId("entry")).toHaveCount(17);
  await expect(earlier).toBeHidden();

  // Empty, the field says what it searches, at the chips' inset from the screen's edge.
  const note = journal.getByText(/^Searches the Entries, Tasks, Projects and Persons of /);
  await expect(note).toBeVisible();
  const [noteBox, firstChip] = [
    await note.boundingBox(),
    await chips.getByRole("button").first().boundingBox(),
  ];
  if (!noteBox || !firstChip) throw new Error("Both are shown");
  expect(noteBox.x).toBe(firstChip.x);

  // A press anywhere on the field's pill puts the caret in it, by its icon too.
  await back.focus();
  await pressFieldEnd(page, field);
  await expect(field).toBeFocused();

  await field.fill("shed");
  await expect(found.getByTestId("search-hit")).toHaveCount(19);
  await expect(composer).toBeHidden();
  await expect(tabs).toBeVisible();

  // The chips are one row that scrolls sideways, so they never push what is found down.
  await expect(chips).toHaveCSS("flex-wrap", "nowrap");
  await expect(chips).toHaveCSS("overflow-x", "auto");

  // Every chip, tick and hit is a touch target, set or not.
  await expectTappable(chips.getByRole("button"));
  await pickTime(page, "Last 7 days");
  const set = chips.getByRole("button", { name: "Last 7 days, remove" });
  await expect(set).toBeVisible();
  await expectTappable(chips.getByRole("button"));
  await expectTappable(found.getByTestId("search-hit"));
  await expect(
    found.getByRole("button", { name: "Finish “Order felt for the shed roof”" }),
  ).toBeVisible();
  await expectTappable(found.getByRole("button"));
  await expectTappable(found.getByRole("link"));
  expect(await heightOf(back)).toBeGreaterThanOrEqual(44);
  await expectTappable(journal.getByRole("button", { name: "Clear the words" }));

  // What is found sits on surface, as the Journal's Entries do: an Entry a card, apart from the next.
  const entries = found.getByRole("region", { name: /^Entries / }).getByTestId("search-hit");
  const tasksFound = found.getByRole("region", { name: /^Tasks / }).getByTestId("search-hit");
  const projectsFound = found.getByRole("region", { name: /^Projects / }).getByTestId("search-hit");
  for (const hit of [entries.first(), tasksFound.first(), projectsFound.first()]) {
    expect(await backgroundOf(hit.locator(".search-hit-body").first())).toBe(card);
  }
  await expect(entries.first().locator(".search-hit-body")).toHaveCSS(
    "border-radius",
    await earlier.evaluate((element) => getComputedStyle(element).borderRadius),
  );
  const [firstEntry, secondEntry] = [
    await entries.nth(0).boundingBox(),
    await entries.nth(1).boundingBox(),
  ];
  if (!firstEntry || !secondEntry) throw new Error("Both are shown");
  expect(secondEntry.y - (firstEntry.y + firstEntry.height)).toBe(8);

  // Back ends the search, words and chips both, and the Journal is as it was left, the focus on
  // the button the search was opened from.
  await back.click();
  await expect(back).toHaveCount(0);
  await expect(field).toHaveValue("");
  await expect(field).toBeHidden();
  await expect(open).toBeFocused();
  await expect(found).toHaveCount(0);
  await expect(heading).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(earlier).toBeVisible();
  expect(await earlier.boundingBox()).toEqual(left);

  // A chip set to a long name takes the row past the screen's width, still one line, and it
  // scrolls sideways to the last chip and back.
  await enterSearch(page);
  await field.fill("felt");
  await expect(found.getByTestId("search-hit")).toHaveCount(2);
  await chips.getByRole("button", { name: "Project", exact: true }).click();
  // A picker's field and each of its choices are touch targets.
  const picker = journal.getByRole("dialog", { name: "Project" });
  await expectTappable(picker.getByRole("combobox", { name: "Find a Project" }));
  await expect(picker.getByRole("option").first()).toBeVisible();
  await expectTappable(picker.getByRole("option"));
  await picker.getByRole("option", { name: new RegExp(`^${ROOFING}`) }).click();
  await expect(chips.getByRole("button", { name: `Project: ${ROOFING}, remove` })).toBeVisible();
  await expect(found.getByTestId("search-hit")).toHaveCount(2);
  const row = await chips.evaluate((shown) => {
    const boxes = [...shown.querySelectorAll(".chip")].map((chip) => chip.getBoundingClientRect());
    return {
      beyond: shown.scrollWidth - shown.clientWidth,
      lowestTop: Math.max(...boxes.map((box) => box.top)),
      highestBottom: Math.min(...boxes.map((box) => box.bottom)),
    };
  });
  expect(row.beyond).toBeGreaterThan(0);
  // One line: every chip's top above every other chip's bottom.
  expect(row.lowestTop).toBeLessThan(row.highestBottom);
  const author = chips.getByRole("button", { name: "Author", exact: true });
  await expect(author).not.toBeInViewport({ ratio: 1 });
  await chips.evaluate((shown) => shown.scrollTo({ left: shown.scrollWidth }));
  await expect(author).toBeInViewport({ ratio: 1 });
  await chips.evaluate((shown) => shown.scrollTo({ left: 0 }));
  await expect(chips.getByRole("button", { name: "Any time" })).toBeInViewport({ ratio: 1 });

  // Left open on a hit found with the time chip's picker open, for the accessibility check.
  await chips.getByRole("button", { name: "Any time" }).click();
  await expect(journal.getByRole("dialog", { name: "Time" })).toBeVisible();
  await expect(back).toBeVisible();
});

test("on a desktop, search stays in the Journal column with the composer below what is found", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "A desktop keeps search in the Journal column.");
  const { journal, composer, field, chips, found } = await longJournal(page, testInfo);
  // A press anywhere on the field's pill puts the caret in it.
  await pressFieldEnd(page, field);
  await expect(field).toBeFocused();
  // The field is 44px high, as on a phone.
  expect(await heightOf(field.locator(".."))).toBe(44);
  await journal.getByRole("heading", { name: "Journal", exact: true }).click();
  await expect(field).not.toBeFocused();
  // Its field is a pill in the Journal's header, beside its title, and its chips wait until the
  // search is in use.
  const heading = journal.getByRole("heading", { name: "Journal", exact: true });
  const [fieldBox, headingBox] = [await field.boundingBox(), await heading.boundingBox()];
  if (!fieldBox || !headingBox) throw new Error("Both are shown");
  expect(
    Math.abs(fieldBox.y + fieldBox.height / 2 - (headingBox.y + headingBox.height / 2)),
  ).toBeLessThan(8);
  expect(fieldBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
  await expect(chips).toBeHidden();
  await field.focus();
  await expect(chips).toBeVisible();
  // Left with nothing asked, it folds back to its field.
  await heading.click();
  await expect(chips).toBeHidden();
  await field.fill("felt");
  await expect(chips).toBeVisible();
  const hits = found.getByTestId("search-hit");
  await expect(hits).toHaveCount(2);
  await expect(journal.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  await expect(journal.getByRole("button", { name: "Back to the Journal" })).toHaveCount(0);
  await expect(composer).toBeVisible();
  const foundBox = await found.boundingBox();
  const composerBox = await composer.boundingBox();
  if (!foundBox || !composerBox) throw new Error("Both are shown");
  expect(composerBox.y).toBeGreaterThan(foundBox.y);
});
