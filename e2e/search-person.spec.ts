import type { Page, TestInfo } from "@playwright/test";
import { callContextTool, contextOfOwn, expect, openJournal, test } from "./fixtures.ts";

// The Person chip narrows search to a Person, with words or without, and a Person found leads to
// everything about them (section 8.4). Its picker is the composer's `@` picker. With no words, a
// Person lists every Entry that Mentions them and every Task ever Delegated to them, newest first.

const DAY = 24 * 60 * 60 * 1000;

/** A Context of this journey's own, its Persons and the Entries and Tasks about them. */
async function contextWithPersons(page: Page, testInfo: TestInfo) {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const context = await contextOfOwn(page, testInfo, "Persons");
  const call = async (tool: string, input: unknown) =>
    callContextTool(page, context.id, tool, input);
  const person = async (name: string) => (await call("create_person", { name })).record;
  const ana = await person(`Ana ${tag}`);
  // Two Persons with one name, which the picker tells apart as `@` does.
  const bo = await person(`Bo ${tag}`);
  await person(`Bo ${tag}`);
  const kitchen = (await call("create_project", { name: `Kitchen ${tag}` })).record;
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  const entry = async (words: string, input: Record<string, unknown> = {}) =>
    (await call("record_entry", { words, ...input })).record;
  const mentioning = (id: string) => ({ to: { kind: "person", id } });
  await entry(`Lunch with Ana a month ago ${tag}`, {
    links: [mentioning(ana.id), { to: { kind: "project", id: kitchen.id } }],
    made_at: ago(40),
  });
  await entry(`Coffee with Bo ${tag}`, { links: [mentioning(bo.id)] });
  // A Task Delegated to Ana and since finished, so no longer Delegated, is still about her.
  const holding = await entry(`Plans to share ${tag}`);
  const task = (await call("add_task", { entry_id: holding.id, title: "Send the plans" })).record;
  await call("delegate_task", { id: task.id, person_id: ana.id });
  await call("finish_task", { id: task.id });
  await entry(`Called Ana ${tag}`, { links: [mentioning(ana.id)] });
  return { tag, ana: ana.name, bo: bo.name, kitchen: kitchen.name };
}

async function openSearch(page: Page, testInfo: TestInfo) {
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const field = journal.getByRole("searchbox", { name: "Search this Context" });
  const chips = journal.getByRole("group", { name: "Narrow the search" });
  const found = journal.getByRole("region", { name: "Found" });
  return { journal, field, chips, found, excerpts: found.getByTestId("search-excerpt") };
}

test("the Person chip picks a Person as `@` does and lists everything about them newest first", async ({
  page,
}, testInfo) => {
  const { tag, ana, bo, kitchen } = await contextWithPersons(page, testInfo);
  const { journal, field, chips, found, excerpts } = await openSearch(page, testInfo);

  // The picker offers the Persons, two of one name told apart, and never a new one.
  const personChip = chips.getByRole("button", { name: "Person", exact: true });
  await personChip.click();
  const picker = journal.getByRole("dialog", { name: "Person" });
  const finder = picker.getByRole("combobox", { name: "Find a Person" });
  await expect(finder).toBeFocused();
  const persons = picker.getByRole("listbox", { name: "Persons" });
  await expect(persons.getByRole("option")).toHaveCount(3);
  await expect(persons.getByRole("option", { name: ana, exact: true })).toBeVisible();
  await expect(
    persons.getByRole("option", { name: `${bo} · last in “Coffee with Bo ${tag}”` }),
  ).toBeVisible();
  await expect(persons.getByRole("option", { name: `${bo} · never Mentioned` })).toBeVisible();
  await finder.fill("ana");
  await expect(persons.getByRole("option")).toHaveText([ana]);
  await expect(persons.getByText(/New Person/)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);

  // Set, the chip says the Person, and with no words every Entry that Mentions them and every
  // Task ever Delegated to them is listed, a finished one too, newest first under each kind.
  const anaChip = chips.getByRole("button", { name: `Person: ${ana}, remove` });
  await expect(anaChip).toHaveText(ana);
  await expect(anaChip).toBeFocused();
  await expect(found.getByRole("status")).toHaveText(`Everything about ${ana}, newest first`);
  await expect(excerpts).toHaveText([
    "Send the plans",
    `Called Ana ${tag}`,
    `Lunch with Ana a month ago ${tag}`,
  ]);
  await expect(found.getByRole("heading", { name: "Persons" })).toHaveCount(0);
  await expect(journal.getByRole("list", { name: "Entries" })).toBeHidden();

  // With words, it narrows the words' list.
  await field.fill("lunch");
  await expect(excerpts).toHaveText([`Lunch with Ana a month ago ${tag}`]);
  await field.fill("");
  await expect(excerpts).toHaveCount(3);

  // The Person chip combines with the time chip and with the Project chip.
  await chips.getByRole("button", { name: "Any time" }).click();
  await journal
    .getByRole("dialog", { name: "Time" })
    .getByRole("button", { name: "Last 7 days" })
    .click();
  await expect(excerpts).toHaveText(["Send the plans", `Called Ana ${tag}`]);
  await chips.getByRole("button", { name: "Last 7 days, remove" }).click();
  await chips.getByRole("button", { name: "Project", exact: true }).click();
  await journal
    .getByRole("dialog", { name: "Project" })
    .getByRole("option", { name: kitchen })
    .click();
  await expect(found.getByRole("status")).toHaveText(
    `Everything in ${kitchen} about ${ana}, newest first`,
  );
  await expect(excerpts).toHaveText([`Lunch with Ana a month ago ${tag}`]);
  await chips.getByRole("button", { name: `Project: ${kitchen}, remove` }).click();
  await expect(excerpts).toHaveCount(3);

  // Lifted, with no words, nothing is asked.
  await anaChip.click();
  await expect(found).toHaveCount(0);

  // Left open, so the accessibility check sees the picker and its choices.
  await personChip.click();
  await expect(persons.getByRole("option")).toHaveCount(3);
});

test("tapping a Person found narrows the search to them and clears the words", async ({
  page,
}, testInfo) => {
  const { tag, ana } = await contextWithPersons(page, testInfo);
  const { journal, field, chips, found, excerpts } = await openSearch(page, testInfo);
  const personsFound = found.getByRole("region", { name: /^Persons/ });

  await field.fill(tag);
  await personsFound.getByRole("button", { name: new RegExp(ana) }).click();
  await expect(field).toHaveValue("");
  const anaChip = chips.getByRole("button", { name: `Person: ${ana}, remove` });
  await expect(anaChip).toBeVisible();
  await expect(found.getByRole("status")).toHaveText(`Everything about ${ana}, newest first`);
  await expect(excerpts).toHaveCount(3);

  // Nothing about her holding the words, Nothing found offers to lift the Person chip.
  await field.fill("coffee");
  const status = found.getByRole("status");
  await expect(status).toContainText("Nothing found for “coffee”");
  await expect(status).toContainText(`Only what is about ${ana} is searched.`);
  await found.getByRole("button", { name: "Search every Person" }).click();
  await expect(chips.getByRole("button", { name: "Person", exact: true })).toBeVisible();
  await expect(excerpts).toHaveText([`Coffee with Bo ${tag}`]);
  await expect(field).toHaveValue("coffee");

  // Opening a hit ends the search, its chips too, and shows it in the Journal.
  await field.fill(tag);
  await personsFound.getByRole("button", { name: new RegExp(ana) }).click();
  await expect(anaChip).toBeVisible();
  await found.getByRole("link", { name: new RegExp(`Called Ana ${tag}`) }).click();
  await expect(found).toHaveCount(0);
  await expect(chips.getByRole("button", { name: "Person", exact: true })).toBeVisible();
  await expect(journal.getByRole("list", { name: "Entries" })).toBeVisible();
});
