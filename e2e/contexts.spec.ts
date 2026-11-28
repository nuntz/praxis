import type { Locator, Page } from "@playwright/test";
import {
  callContextTool,
  callDeploymentTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  openSettings,
  showSection,
  switchTo,
  test,
} from "./fixtures.ts";

// The person defines several Contexts and switches between them in the top bar. Each is its own,
// and nothing is shown from two at once (sections 3.1 and 8.1, ADR 0003).

/** Rust and Moss, solid, in light: the accents the two Contexts here are made in. */
const RUST = "rgb(168, 72, 12)";
const MOSS = "rgb(76, 106, 20)";

const switcher = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Context: / });

test("the person switches Context in the top bar, and sees and records only in the one switched to", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "rust" });
  const home = await makeContext(page, { name: `Home ${tag}`, time_zone: "UTC", accent: "moss" });
  await callContextTool(page, work.id, "record_entry", { words: `Quarterly plan ${tag}` });
  await lastShown(page, work.id);

  await page.goto("/");
  await expect(switcher(page)).toHaveAccessibleName(`Context: ${work.name}`);
  await expect(switcher(page)).toHaveCSS("background-color", RUST);
  let { journal, composer } = await openJournal(page, testInfo);
  await expect(journal.getByText(`Quarterly plan ${tag}`)).toBeVisible();

  await switchTo(page, home.name);

  await expect(switcher(page)).toHaveCSS("background-color", MOSS);
  ({ journal, composer } = await openJournal(page, testInfo));
  await expect(composer).toHaveAccessibleName(`Record an Entry in ${home.name}`);
  await expect(journal.getByTestId("composer")).toHaveCSS("border-top-color", MOSS);
  await expect(journal.getByText(`Quarterly plan ${tag}`)).toHaveCount(0);
  await composer.fill(`Fix the bike ${tag}`);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByText(`Fix the bike ${tag}`)).toBeVisible();

  // The browser keeps the Context it last showed.
  await page.reload();
  await expect(switcher(page)).toHaveAccessibleName(`Context: ${home.name}`);

  // Where the Entry went is where it was recorded, and only there.
  await switchTo(page, work.name);
  ({ journal } = await openJournal(page, testInfo));
  await expect(journal.getByText(`Quarterly plan ${tag}`)).toBeVisible();
  await expect(journal.getByText(`Fix the bike ${tag}`)).toHaveCount(0);
  const homeEntries = await callContextTool(page, home.id, "list_entries", {});
  expect(homeEntries.items.map((entry: { words: string }) => entry.words)).toEqual([
    `Fix the bike ${tag}`,
  ]);
});

test("the switcher is in the top bar at the width in between too", async ({ page }, testInfo) => {
  test.skip(onPhone(testInfo), "The in-between width is set on the desktop's Device.");
  await page.setViewportSize({ width: 960, height: 800 });
  await page.goto("/");

  await expect(switcher(page)).toBeVisible();
});

/** A Context's row in Settings, found by its name as its title shows it. */
const contextRow = (contexts: Locator, name: string) =>
  contexts
    .getByTestId("context-row")
    .filter({ has: contexts.page().getByText(name, { exact: true }) });

/** Choose an act behind a row's More, as the person does. */
async function behindMore(row: Locator, name: string, act: string) {
  await row.getByRole("button", { name: `More for ${name}`, exact: true }).click();
  await row
    .page()
    .getByRole("menu", { name: `More for ${name}`, exact: true })
    .getByRole("menuitem", { name: act, exact: true })
    .click();
}

test("the Deployment's settings list the Contexts with their accents, and make, recolour, retire and bring one back", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "rust" });
  await lastShown(page, work.id);
  await page.goto("/");
  const contexts = await openSettings(page, "Contexts");
  const row = (name: string) => contextRow(contexts, name);
  const side = `Side ${tag}`;

  // Each Context with its accent in its note, the current one said to be.
  await expect(row(work.name).getByText("Rust · Current", { exact: true })).toBeVisible();

  // The form is opened on demand, its first field focused, and its button the section's one solid
  // button only while it is open.
  const form = contexts.getByRole("form", { name: "New Context" });
  await expect(form).toHaveCount(0);
  await expect(contexts.getByRole("button", { name: "Make the Context" })).toHaveCount(0);
  await contexts.getByRole("button", { name: "New Context…", exact: true }).click();
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  // Cancelled, it closes, the focus back on what opened it.
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(contexts.getByRole("button", { name: "New Context…", exact: true })).toBeFocused();

  // A new Context, made here, in this Device's time zone, becomes the current one.
  await contexts.getByRole("button", { name: "New Context…", exact: true }).click();
  await form.getByLabel("Name", { exact: true }).fill(side);
  await form.getByRole("combobox", { name: "Accent", exact: true }).selectOption("plum");
  await form.getByRole("button", { name: "Make the Context" }).click();
  await expect(switcher(page)).toHaveAccessibleName(`Context: ${side}`);
  await expect(row(side).getByText("Plum · Current", { exact: true })).toBeVisible();
  await expect(row(work.name).getByText("Rust", { exact: true })).toBeVisible();
  await expect(form).toHaveCount(0);
  // Made, the focus goes back on what opened the form, as Cancel puts it.
  await expect(contexts.getByRole("button", { name: "New Context…", exact: true })).toBeFocused();

  // Another accent, from round swatches opened in place, the one it has said in words and
  // pressed; shown at once in the switcher.
  await behindMore(row(side), side, "Accent");
  const accents = row(side).getByRole("group", { name: `Accent of ${side}`, exact: true });
  await expect(accents.getByRole("button", { name: "Plum", exact: true })).toBeFocused();
  await expect(accents.getByRole("button", { name: "Plum", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(accents).toHaveAccessibleDescription("Plum now");
  await accents.getByRole("button", { name: "Moss", exact: true }).click();
  await expect(switcher(page)).toHaveCSS("background-color", MOSS);
  await expect(accents).toHaveCount(0);
  await expect(row(side).getByText("Moss · Current", { exact: true })).toBeVisible();
  await expect(row(side).getByRole("button", { name: `More for ${side}` })).toBeFocused();

  // Retire only marks it, saying what else ends with it, beside a Keep it that takes the focus
  // and gives it back to More.
  for (const n of [1, 2]) {
    await callDeploymentTool(page, "create_connection", {
      name: `Agent ${n} ${tag}`,
      context_id: work.id,
      reading_only: false,
    });
  }
  const keep = (name: string) => row(name).getByRole("button", { name: "Keep it", exact: true });
  await behindMore(row(work.name), work.name, "Retire");
  await expect(
    row(work.name).getByText("Retires when you leave Contexts. Its 2 Connections end.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(keep(work.name)).toBeFocused();
  await keep(work.name).click();
  await expect(row(work.name).getByRole("button", { name: `More for ${work.name}` })).toBeFocused();

  // Retired as Contexts is left, it leaves the switcher and the screen moves to a Context that is
  // not; brought back, it returns as it was.
  await behindMore(row(side), side, "Retire");
  await expect(
    row(side).getByText("Retires when you leave Contexts. Nothing else ends.", { exact: true }),
  ).toBeVisible();
  await expect(keep(side)).toBeFocused();
  await expect(switcher(page)).toHaveAccessibleName(`Context: ${side}`);
  const retiring = page.waitForResponse(/\/retire_context$/);
  await showSection(page, "Devices");
  expect((await (await retiring).json()).ok).toBe(true);
  await showSection(page, "Contexts");
  await expect(row(side).getByText("Moss · Retired", { exact: true })).toBeVisible();
  await expect(row(work.name).getByText(/^Rust/)).toBeVisible();
  await expect(switcher(page)).not.toHaveAccessibleName(`Context: ${side}`);
  await switcher(page).click();
  const listed = page.getByRole("banner").getByRole("list", { name: "Contexts" });
  await expect(listed.getByRole("button", { name: side })).toHaveCount(0);
  await expect(listed.getByRole("button", { name: work.name })).toBeVisible();
  await page.keyboard.press("Escape");

  await behindMore(row(side), side, "Bring back");
  await expect(row(side).getByText(/^Moss( · Current)?$/)).toBeVisible();
  await switchTo(page, side);
  await expect(switcher(page)).toHaveCSS("background-color", MOSS);
});

test("a Context is renamed in its row, its title turned into its field with the focus in it", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const named = await makeContext(page, { name: `Named ${tag}`, time_zone: "UTC", accent: "teal" });
  const renamed = `Renamed ${tag}`;
  await page.goto("/");
  const contexts = await openSettings(page, "Contexts");
  const more = (name: string) =>
    contexts.getByRole("button", { name: `More for ${name}`, exact: true });

  await behindMore(contextRow(contexts, named.name), named.name, "Rename");
  const field = contexts.getByRole("textbox", { name: `Name of ${named.name}`, exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(named.name);
  await expect(contexts.getByText(named.name, { exact: true })).toHaveCount(0);

  // Escape leaves the field, and Settings stays.
  await field.fill("Never kept");
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(contextRow(contexts, named.name)).toBeVisible();
  await expect(more(named.name)).toBeFocused();

  await behindMore(contextRow(contexts, named.name), named.name, "Rename");
  await field.fill(renamed);
  const answered = page.waitForResponse("**/api/deployment/tools/rename_context");
  await field.press("Enter");
  expect((await (await answered).json()).ok).toBe(true);
  await expect(contextRow(contexts, renamed)).toBeVisible();
  await expect(more(renamed)).toBeFocused();
  const { items } = await callDeploymentTool(page, "list_contexts", {});
  expect(items.find((context: { id: string }) => context.id === named.id)).toMatchObject({
    name: renamed,
  });
});

test("a retired Context is deleted for good from the settings once its name is typed, with an Export offered first", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const old = await makeContext(page, { name: `Old ${tag}`, time_zone: "UTC", accent: "slate" });
  await callContextTool(page, old.id, "record_entry", { words: `Old plan ${tag}` });
  await callDeploymentTool(page, "retire_context", { id: old.id });
  await page.goto("/");
  const contexts = await openSettings(page, "Contexts");
  const row = contextRow(contexts, old.name);

  await behindMore(row, old.name, "Delete…");
  const form = row.getByRole("form", { name: `Delete ${old.name}` });
  await expect(form.getByRole("button", { name: "Make an Export" })).toBeVisible();
  await expect(form.getByText("Praxis cannot reach a file you downloaded")).toBeVisible();
  await expect(form.getByText("Its files in Backups go as those Backups age out")).toBeVisible();
  const remove = form.getByRole("button", { name: `Delete ${old.name} for good` });
  const typed = form.getByRole("textbox", { name: `Type ${old.name} to delete it` });
  await expect(remove).toBeDisabled();
  await typed.fill(`old ${tag}`);
  await expect(remove).toBeDisabled();
  await typed.fill(old.name);

  const answered = page.waitForResponse("**/api/deployment/tools/delete_context");
  await remove.click();
  expect((await answered).ok()).toBe(true);

  await expect(row).toHaveCount(0);
  const listed = await callDeploymentTool(page, "list_contexts", {});
  expect(listed.items.map((context: { id: string }) => context.id)).not.toContain(old.id);
});
