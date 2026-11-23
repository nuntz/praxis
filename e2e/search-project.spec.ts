import type { Page, TestInfo } from "@playwright/test";
import { callContextTool, contextOfOwn, expect, onPhone, openJournal, test } from "./fixtures.ts";

// The Project chip narrows search to a Project, with words or without, and a Project found leads
// into it (section 8.4). Its picker is the composer's `#` picker, offering Projects alone, the
// Finished and Dropped ones marked. With no words, a Project lists everything in it, newest first.

const DAY = 24 * 60 * 60 * 1000;

/** A Context of this journey's own, its Projects and the Entries and Tasks in them. */
async function contextWithProjects(page: Page, testInfo: TestInfo) {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const context = await contextOfOwn(page, testInfo, "Projects");
  const call = async (tool: string, input: unknown) =>
    callContextTool(page, context.id, tool, input);
  const project = async (name: string) => (await call("create_project", { name })).record;
  const kitchen = await project(`Kitchen ${tag}`);
  const garden = await project(`Garden ${tag}`);
  const attic = await project(`Attic ${tag}`);
  await call("finish_project", { id: garden.id });
  await call("drop_project", { id: attic.id });
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  const entry = async (words: string, input: Record<string, unknown> = {}) =>
    (await call("record_entry", { words, ...input })).record;
  await entry(`Tiles chosen a month ago ${tag}`, {
    links: [{ to: { kind: "project", id: kitchen.id } }],
    made_at: ago(40),
  });
  await entry(`Seeds sown ${tag}`, { links: [{ to: { kind: "project", id: garden.id } }] });
  // Its Task is made after it, so the Task is the newer of the two.
  const holding = await entry(`Things to order ${tag}`);
  const task = (await call("add_task", { entry_id: holding.id, title: "Order the tap" })).record;
  await call("move_task", { id: task.id, project_id: kitchen.id });
  await entry(`Paint the hall ${tag}`);
  return { tag, kitchen: kitchen.name, garden: garden.name, attic: attic.name };
}

async function openSearch(page: Page, testInfo: TestInfo) {
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const field = journal.getByRole("searchbox", { name: "Search this Context" });
  const chips = journal.getByRole("group", { name: "Narrow the search" });
  const found = journal.getByRole("region", { name: "Found" });
  return { journal, field, chips, found, excerpts: found.getByTestId("search-excerpt") };
}

test("the Project chip picks a Project as `#` does, closed ones marked, and lists everything in it newest first", async ({
  page,
}, testInfo) => {
  const { tag, kitchen, garden, attic } = await contextWithProjects(page, testInfo);
  const { journal, field, chips, found, excerpts } = await openSearch(page, testInfo);

  // The picker offers Projects alone, the closed ones marked, and never a new one.
  const projectChip = chips.getByRole("button", { name: "Project", exact: true });
  await projectChip.click();
  const picker = journal.getByRole("dialog", { name: "Project" });
  const finder = picker.getByRole("combobox", { name: "Find a Project" });
  await expect(finder).toBeFocused();
  const projects = picker.getByRole("listbox", { name: "Projects" });
  await expect(projects.getByRole("option")).toHaveText([
    `${attic} · Dropped`,
    `${garden} · Finished`,
    kitchen,
  ]);
  await finder.fill("kitch");
  await expect(projects.getByRole("option")).toHaveText([kitchen]);
  await expect(projects.getByText(/New Project/)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);

  // Set, the chip says the Project, and with no words everything in it is listed, newest first.
  const kitchenChip = chips.getByRole("button", { name: `Project: ${kitchen}, remove` });
  await expect(kitchenChip).toHaveText(kitchen);
  await expect(kitchenChip).toBeFocused();
  await expect(found.getByRole("status")).toHaveText(`Everything in ${kitchen}, newest first`);
  await expect(excerpts).toHaveText([
    "Order the tap",
    `Things to order ${tag}`,
    `Tiles chosen a month ago ${tag}`,
  ]);
  await expect(found.getByRole("heading", { name: "Projects" })).toHaveCount(0);
  await expect(found.locator("mark")).toHaveCount(0);
  await expect(journal.getByRole("list", { name: "Entries" })).toBeHidden();
  await expect(field).toHaveAttribute("placeholder", `Search within ${kitchen}`);

  // With words, it narrows the words' list.
  await field.fill("tiles");
  await expect(excerpts).toHaveText([`Tiles chosen a month ago ${tag}`]);
  await field.fill("");
  await expect(excerpts).toHaveCount(3);

  // The Project chip and the time chip combine.
  await chips.getByRole("button", { name: "Any time" }).click();
  await journal
    .getByRole("dialog", { name: "Time" })
    .getByRole("button", { name: "Last 7 days" })
    .click();
  await expect(excerpts).toHaveText(["Order the tap", `Things to order ${tag}`]);
  await chips.getByRole("button", { name: "Last 7 days, remove" }).click();

  // Lifted, with no words, nothing is asked, and on a desktop the Entries are shown again; a
  // phone keeps the search's screen until its back arrow.
  await kitchenChip.click();
  await expect(found).toHaveCount(0);
  await expect(journal.getByRole("list", { name: "Entries" })).toBeVisible({
    visible: !onPhone(testInfo),
  });

  // Left open, so the accessibility check sees the picker and its choices.
  await projectChip.click();
  await expect(projects.getByRole("option")).toHaveCount(3);
});

test("tapping a Project found narrows the search to it and clears the words, a Finished one too", async ({
  page,
}, testInfo) => {
  const { tag, kitchen, garden } = await contextWithProjects(page, testInfo);
  const { journal, field, chips, found, excerpts } = await openSearch(page, testInfo);
  const projectsFound = found.getByRole("region", { name: /^Projects/ });

  await field.fill(tag);
  await projectsFound.getByRole("button", { name: new RegExp(kitchen) }).click();
  await expect(field).toHaveValue("");
  await expect(chips.getByRole("button", { name: `Project: ${kitchen}, remove` })).toBeVisible();
  await expect(found.getByRole("status")).toHaveText(`Everything in ${kitchen}, newest first`);
  await expect(excerpts).toHaveCount(3);

  // A Finished Project, which Attention never opens, leads somewhere too.
  await chips.getByRole("button", { name: `Project: ${kitchen}, remove` }).click();
  await field.fill(tag);
  await projectsFound.getByRole("button", { name: new RegExp(garden) }).click();
  await expect(field).toHaveValue("");
  await expect(chips.getByRole("button", { name: `Project: ${garden}, remove` })).toBeVisible();
  await expect(excerpts).toHaveText([`Seeds sown ${tag}`]);

  // Opening a hit ends the search, its chip too, and shows it in the Journal.
  await found.getByRole("link", { name: new RegExp(`Seeds sown ${tag}`) }).click();
  await expect(found).toHaveCount(0);
  await expect(chips.getByRole("button", { name: "Project", exact: true })).toBeVisible();
  await expect(journal.getByRole("list", { name: "Entries" })).toBeVisible();
});
