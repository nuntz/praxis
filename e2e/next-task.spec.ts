import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  expect,
  holdNext,
  lastShown,
  makeContext,
  onPhone,
  showTab,
  switchTo,
  test,
} from "./fixtures.ts";

// A Project with no open Task offers to write its next Task: its page aims the Journal's composer
// at it for one Entry, and every Task that Entry makes is put in it (section 8.3). Each journey
// makes a Context of its own, so the Project's row and count are its own.

/** A Context of this journey's own, shown on opening, holding one Project with no Task. */
async function contextWithProject(page: Page, testInfo: TestInfo, name: string) {
  const context = await makeContext(page, {
    name: `Home ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "moss",
  });
  await lastShown(page, context.id);
  const { record } = await callContextTool(page, context.id, "create_project", { name });
  return { id: context.id, name: context.name, project: record as { id: string; name: string } };
}

/** The Project's page, opened from its row in Attention. */
async function openProject(page: Page, name: string) {
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  await attention
    .getByRole("region", { name: "Projects", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  return attention.getByRole("dialog", { name });
}

test("from a Project with no open Task the person writes its next Task, and the Task joins it", async ({
  page,
}, testInfo) => {
  await contextWithProject(page, testInfo, "Roof");

  await page.goto("/");
  const roof = await openProject(page, "Roof");
  await expect(roof.getByText("No Tasks yet.")).toBeVisible();
  await roof.getByRole("button", { name: /^Write its next Task/ }).click();

  // The Journal is shown, on a phone its tab untouched, its composer has the caret and says what it
  // is aimed at, and nothing is put in the words.
  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: /^Record an Entry in / });
  await expect(journal).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(journal.getByText("Next Task for Roof")).toBeVisible();
  await expect(composer).toHaveValue("");

  await composer.fill("The gutter leaks again\n[] Call the roofer");
  const moved = page.waitForResponse(/\/tools\/move_task$/);
  await journal.getByRole("button", { name: "Record" }).click();
  expect((await (await moved).json()).ok).toBe(true);
  // The aim lasted the one Entry.
  await expect(journal.getByText("Next Task for Roof")).toHaveCount(0);

  // The Project's page, still open, lists it, and its row back in Attention counts it.
  await showTab(page, testInfo, "Attention");
  await expect(
    roof
      .getByRole("list", { name: "Tasks in Roof" })
      .getByRole("checkbox", { name: "Call the roofer", exact: true }),
  ).toBeVisible();
  await roof.getByRole("button", { name: "Back to Attention" }).click();
  const row = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("region", { name: "Projects", exact: true })
    .getByRole("button", { name: "Roof", exact: true });
  await expect(row).toContainText("1 actionable");
  await expect(row).not.toContainText("Needs a next Task");
});

/**
 * Attention brought into view: on a phone by its tab, in between by its button in the top bar,
 * which opens it as a layer; on a desktop it is there.
 */
async function showAttention(page: Page, testInfo: TestInfo) {
  if (onPhone(testInfo)) return showTab(page, testInfo, "Attention");
  const button = page.getByRole("banner").getByRole("button", { name: /^Attention/ });
  if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
}

test("the aim lasts one Entry: removing it, switching Context or an Entry that makes no Task ends it, the last saying nothing more, and an aim taken while it is on its way stays", async ({
  page,
}, testInfo) => {
  // In between, Attention is a layer over the Journal, which closes as the composer is aimed.
  if (!onPhone(testInfo)) await page.setViewportSize({ width: 1024, height: 800 });
  const here = await contextWithProject(page, testInfo, "Garden");
  const elsewhere = await makeContext(page, {
    name: `Elsewhere ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "teal",
  });
  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: /^Record an Entry in / });
  const aimed = journal.getByText("Next Task for Garden");
  const attentionButton = page.getByRole("banner").getByRole("button", { name: /^Attention/ });
  const moves: string[] = [];
  page.on("request", (request) => {
    if (/\/tools\/move_task$/.test(request.url())) moves.push(request.postDataJSON().id);
  });

  /** Aim the composer at Garden from its page, opened afresh unless it is open already. */
  async function aim() {
    await showAttention(page, testInfo);
    const garden = page
      .getByRole("region", { name: "Attention", exact: true })
      .getByRole("dialog", { name: "Garden" });
    if (!(await garden.isVisible())) await openProject(page, "Garden");
    await garden.getByRole("button", { name: /^Write its next Task/ }).click();
    if (!onPhone(testInfo)) await expect(attentionButton).toHaveAttribute("aria-expanded", "false");
    await expect(composer).toBeFocused();
    await expect(aimed).toBeVisible();
  }

  await page.goto("/");
  await aim();
  await journal.getByRole("button", { name: "Not for Garden" }).click();
  await expect(aimed).toHaveCount(0);

  await aim();
  await switchTo(page, elsewhere.name);
  await switchTo(page, here.name);
  await expect(composer).toBeVisible();
  await expect(aimed).toHaveCount(0);

  // Aimed again while the Entry is on its way, the aim is for the next one, and stays.
  await aim();
  await composer.fill("Weeded the beds");
  const held = await holdNext(page, /\/tools\/record_entry$/);
  const recorded = page.waitForResponse(/\/tools\/record_entry$/);
  await journal.getByRole("button", { name: "Record" }).click();
  await held.asked();
  await aim();
  await held.release();
  expect((await (await recorded).json()).ok).toBe(true);
  await expect(journal.getByText("Weeded the beds")).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(aimed).toBeVisible();

  // Recorded as any Entry is: nothing is put in Garden, nothing is said, and its flag still shows.
  await showAttention(page, testInfo);
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  await attention
    .getByRole("dialog", { name: "Garden" })
    .getByRole("button", { name: "Back to Attention" })
    .click();
  await expect(
    attention
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Garden", exact: true }),
  ).toContainText("Needs a next Task");
  await expect(attention.getByText(/made but not put in/)).toHaveCount(0);
  expect(moves).toEqual([]);

  // The composer still says what it is aimed at, which is where this ends.
  if (onPhone(testInfo)) await showTab(page, testInfo, "Journal");
  else await attentionButton.click();
  await expect(aimed).toBeVisible();
});

test("a Task made but not put in its Project is said at the top of Attention, with Try again, and nothing is undone", async ({
  page,
}, testInfo) => {
  const { id, project } = await contextWithProject(page, testInfo, "Shed");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: /^Record an Entry in / });

  await page.goto("/");
  const shed = await openProject(page, "Shed");
  await shed.getByRole("button", { name: /^Write its next Task/ }).click();
  await expect(composer).toBeFocused();
  // Deleted while the composer is aimed at it, the Project can no longer take the Task.
  await showTab(page, testInfo, "Attention");
  const deleted = page.waitForResponse(/\/tools\/delete_project$/);
  await shed.getByRole("button", { name: /^Delete/ }).click();
  expect((await (await deleted).json()).ok).toBe(true);

  await showTab(page, testInfo, "Journal");
  await composer.fill("The shed door sticks\n[] Plane the shed door");
  const moved = page.waitForResponse(/\/tools\/move_task$/);
  await journal.getByRole("button", { name: "Record" }).click();
  expect((await (await moved).json()).ok).toBe(false);

  // Said where a change made from a page is; the Task stays made, on its Entry.
  await expect(
    journal.getByRole("checkbox", { name: "Plane the shed door", exact: true }),
  ).toBeVisible();
  await showTab(page, testInfo, "Attention");
  const said = attention.getByRole("status").filter({ hasText: "made but not put in" });
  await expect(said).toHaveText(/^“Plane the shed door” was made but not put in Shed\. Try again$/);

  // Tried again while the Project is still in the Trash, it is refused, and still said.
  const refused = page.waitForResponse(/\/tools\/move_task$/);
  await said.getByRole("button", { name: "Try again" }).click();
  expect((await (await refused).json()).ok).toBe(false);
  await expect(attention.getByRole("alert")).toBeVisible();
  await expect(said).toBeVisible();

  // Back from the Trash, Try again puts it there, and the line goes.
  await callContextTool(page, id, "restore", { id: project.id });
  const joined = page.waitForResponse(/\/tools\/move_task$/);
  await said.getByRole("button", { name: "Try again" }).click();
  expect((await (await joined).json()).ok).toBe(true);
  await expect(said).toHaveCount(0);
  await expect(
    attention
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Shed", exact: true }),
  ).toContainText("1 actionable");
});

test("with no network the page does not offer to write its next Task and says it needs the network, and an aimed Entry kept Unsent says its Tasks are not put in", async ({
  page,
}, testInfo) => {
  await contextWithProject(page, testInfo, "Porch");
  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: /^Record an Entry in / });

  await page.goto("/");
  const porch = await openProject(page, "Porch");
  await porch.getByRole("button", { name: /^Write its next Task/ }).click();
  await expect(composer).toBeFocused();

  // Capture never fails: kept Unsent, its Tasks are made only once it is sent, outside the Project.
  await page.context().setOffline(true);
  await composer.fill("The porch light flickers\n[] Change the porch bulb");
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByRole("status").filter({ hasText: "Kept Unsent" })).toHaveText(
    "Kept Unsent, so the Tasks it makes once sent are not put in Porch: put them there from their pages.",
  );
  await expect(journal.getByText("Next Task for Porch")).toHaveCount(0);

  await showTab(page, testInfo, "Attention");
  await expect(porch.getByText("Writing its next Task needs the network.")).toBeVisible();
  await expect(porch.getByRole("button", { name: /^Write its next Task/ })).toHaveCount(0);
});
