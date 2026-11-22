import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  test,
} from "./fixtures.ts";

// An Entry's actions are quiet (section 8.4): with a pointer that hovers, a toolbar of icons shown
// while the Entry is hovered or has the keyboard's focus, Move and Delete behind More; on a touch
// screen, one "⋯" button opening a menu of all five. Its marks are always shown. Each journey has
// a Context of its own, so the Entries it reads are its own.

/** A Context of the journey's own, its Journal open on the Entries recorded in it. */
async function journalWith(page: Page, testInfo: TestInfo, words: string[]) {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await makeContext(page, {
    name: `Quiet ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "moss",
  });
  await lastShown(page, id);
  const entries = [];
  for (const each of words) {
    entries.push(
      (await callContextTool(page, id, "record_entry", { words: `${each} ${tag}` })).record,
    );
  }
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const shown = (words: string) =>
    journal.getByTestId("entry").filter({ hasText: `${words} ${tag}` });
  await expect(shown(words[0] as string)).toHaveCount(1);
  return { id, entries, shown };
}

test("on a desktop, an Entry's actions are a toolbar of icons, shown on hover or focus and reached by Tab", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "A phone's screen is touched, with no pointer that hovers.");
  const { shown } = await journalWith(page, testInfo, ["Quiet actions"]);
  const entry = shown("Quiet actions");
  const toolbar = entry.getByRole("toolbar", { name: "Entry actions", exact: true });

  // Each action an icon with no words, named, and its tooltip saying the same.
  const actions = toolbar.getByRole("button");
  const names = ["Edit", "Follow up", "Mark Standing", "More: Move, Delete"];
  await expect(actions).toHaveText(names.map(() => ""));
  for (const [at, name] of names.entries()) {
    await expect(actions.nth(at)).toHaveAccessibleName(name);
    await expect(actions.nth(at)).toHaveAttribute("title", name);
  }

  // Shown while the Entry is hovered, and put away once the pointer leaves.
  await page.mouse.move(0, 0);
  await expect(toolbar).toHaveCSS("opacity", "0");
  await entry.hover();
  await expect(toolbar).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(toolbar).toHaveCSS("opacity", "0");

  // Tabbing into the Entry reaches each, and shows the toolbar while it has the focus.
  await entry.focus();
  for (const name of names) {
    await page.keyboard.press("Tab");
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeFocused();
    await expect(toolbar).toHaveCSS("opacity", "1");
  }

  // More offers Move and Delete, and Escape puts its menu away, back on More.
  const more = toolbar.getByRole("button", { name: "More: Move, Delete", exact: true });
  await page.keyboard.press("Enter");
  const menu = entry.getByRole("menu", { name: "More: Move, Delete", exact: true });
  await expect(menu.getByRole("menuitem")).toHaveText(["Move", "Delete"]);
  await expect(menu.getByRole("menuitem", { name: "Move", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  // Delete from it by keyboard works as it did: no asking first, put back from the Trash.
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).toBeFocused();
  const deleting = page.waitForResponse(/\/tools\/delete_entry$/);
  await page.keyboard.press("Enter");
  expect((await (await deleting).json()).ok).toBe(true);
  await expect(entry).toHaveCount(0);
});

test("on a touch screen, an Entry's one button opens a menu of its five actions", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "A desktop's pointer hovers, and has the toolbar.");
  const { shown } = await journalWith(page, testInfo, ["Touched actions"]);
  const entry = shown("Touched actions");

  // One button, an icon with no words, named, and its tooltip saying the same.
  const name = "Actions for this Entry";
  await expect(entry.getByRole("toolbar")).toHaveCount(0);
  await expect(entry.getByRole("button")).toHaveText([""]);
  const button = entry.getByRole("button", { name, exact: true });
  await expect(button).toHaveAttribute("title", name);

  await button.click();
  const menu = entry.getByRole("menu", { name, exact: true });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Edit",
    "Follow up",
    "Mark Standing",
    "Move",
    "Delete",
  ]);
  // Put away with a tap on it again, and opened once more, as the accessibility check sees it.
  await button.click();
  await expect(menu).toHaveCount(0);
  await button.click();
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
});

test("an edited Entry and a Standing Entry show their marks with nothing hovered or focused", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await makeContext(page, {
    name: `Marks ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "slate",
  });
  await lastShown(page, id);
  const [plain, edited, standing] = [`Plain ${tag}`, `Edited ${tag}`, `Standing ${tag}`];
  await callContextTool(page, id, "record_entry", { words: plain });
  const { record } = await callContextTool(page, id, "record_entry", { words: edited });
  await callContextTool(page, id, "edit_entry", {
    id: record.id,
    words: `${edited}, again`,
    version: record.version,
  });
  const marked = await callContextTool(page, id, "record_entry", { words: standing });
  await callContextTool(page, id, "mark_standing", { id: marked.record.id });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const entry = (words: string) =>
    journal
      .getByTestId("entry")
      .filter({ has: page.getByTestId("words").getByText(words, { exact: false }) });
  await expect(entry(standing)).toHaveCount(1);
  await page.mouse.move(0, 0);

  await expect(entry(plain).getByText(/^(Edited|Standing)$/)).toHaveCount(0);
  await expect(entry(edited).getByRole("button", { name: "Edited", exact: true })).toBeVisible();
  await expect(entry(edited).getByText("Standing", { exact: true })).toHaveCount(0);
  await expect(entry(standing).getByText("Standing", { exact: true })).toBeVisible();
  await expect(entry(standing).getByRole("button", { name: "Edited", exact: true })).toHaveCount(0);
});
