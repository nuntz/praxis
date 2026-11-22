import type { Page } from "@playwright/test";
import {
  callContextTool,
  callDeploymentTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  openSettings,
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

test("the Deployment's settings list the Contexts with their accents, and make, recolour, retire and bring one back", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "rust" });
  await lastShown(page, work.id);
  await page.goto("/");
  const contexts = await openSettings(page, "Contexts");
  const row = (name: string) =>
    contexts.getByTestId("context-row").filter({
      has: page.getByRole("textbox", { name: `Name of ${name}` }),
    });

  // Each Context with its accent.
  await expect(
    row(work.name).getByRole("combobox", { name: `Accent of ${work.name}`, exact: true }),
  ).toHaveValue("rust");

  // A new Context, made here, in this Device's time zone, becomes the current one.
  const form = contexts.getByRole("form", { name: "New Context" });
  await form.getByLabel("Name", { exact: true }).fill(`Side ${tag}`);
  await form.getByRole("combobox", { name: "Accent", exact: true }).selectOption("plum");
  await form.getByRole("button", { name: "Make the Context" }).click();
  await expect(switcher(page)).toHaveAccessibleName(`Context: Side ${tag}`);
  await expect(
    row(`Side ${tag}`).getByRole("combobox", { name: `Accent of Side ${tag}`, exact: true }),
  ).toHaveValue("plum");

  // Another accent, shown at once in the switcher.
  await row(`Side ${tag}`)
    .getByRole("combobox", { name: `Accent of Side ${tag}`, exact: true })
    .selectOption("moss");
  await expect(switcher(page)).toHaveCSS("background-color", MOSS);

  // Retired, it leaves the switcher and the screen moves to a Context that is not; brought
  // back, it returns as it was.
  await row(`Side ${tag}`)
    .getByRole("button", { name: `Retire Side ${tag}` })
    .click();
  await expect(row(`Side ${tag}`).getByText("Retired")).toBeVisible();
  await expect(switcher(page)).not.toHaveAccessibleName(`Context: Side ${tag}`);
  await switcher(page).click();
  const listed = page.getByRole("list", { name: "Contexts" });
  await expect(listed.getByRole("button", { name: `Side ${tag}` })).toHaveCount(0);
  await expect(listed.getByRole("button", { name: work.name })).toBeVisible();
  await page.keyboard.press("Escape");

  await row(`Side ${tag}`)
    .getByRole("button", { name: `Bring back Side ${tag}` })
    .click();
  await expect(row(`Side ${tag}`).getByText("Retired")).toHaveCount(0);
  await switchTo(page, `Side ${tag}`);
  await expect(switcher(page)).toHaveCSS("background-color", MOSS);
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
  const row = contexts.getByTestId("context-row").filter({
    has: page.getByRole("textbox", { name: `Name of ${old.name}` }),
  });

  await row.getByRole("button", { name: `Delete ${old.name}…` }).click();
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
