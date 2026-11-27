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
// screen, one "⋯" button opening a menu of all six. Its marks are always shown. Each journey has
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
  const { shown } = await journalWith(page, testInfo, ["Quiet actions", "Kept actions"]);
  const entry = shown("Quiet actions");
  const toolbar = entry.getByRole("toolbar", { name: "Entry actions", exact: true });

  // Each action an icon with no words, named, and its tooltip saying the same.
  const actions = toolbar.getByRole("button");
  const names = ["Edit", "Add a Task", "Follow up", "Mark Standing", "More: Move, Delete"];
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

  // The journey ends on the other Entry hovered, its toolbar shown and its More menu open, as the
  // accessibility check sees them.
  const kept = shown("Kept actions");
  const keptToolbar = kept.getByRole("toolbar", { name: "Entry actions", exact: true });
  await kept.hover();
  await expect(keptToolbar).toHaveCSS("opacity", "1");
  await keptToolbar.getByRole("button", { name: "More: Move, Delete", exact: true }).click();
  await expect(
    kept.getByRole("menu", { name: "More: Move, Delete", exact: true }).getByRole("menuitem"),
  ).toHaveText(["Move", "Delete"]);
  await expect(keptToolbar).toHaveCSS("opacity", "1");
});

test("on a desktop, Delete chosen by pointer from a one-line Entry's More deletes that Entry, not the one after it", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "A phone's screen is touched, with no pointer that hovers.");
  const { id, entries, shown } = await journalWith(page, testInfo, ["Pointed at", "After it"]);
  const [deleted] = entries;
  const entry = shown("Pointed at");
  const after = shown("After it");
  const { journal } = await openJournal(page, testInfo);

  // The menu of a one-line Entry reaches over the Entry after it, whose own toolbar is not shown.
  await entry.hover();
  const toolbar = entry.getByRole("toolbar", { name: "Entry actions", exact: true });
  await toolbar.getByRole("button", { name: "More: Move, Delete", exact: true }).click();
  const item = toolbar.getByRole("menu").getByRole("menuitem", { name: "Delete", exact: true });
  await expect(item).toBeVisible();
  const box = await item.boundingBox();
  const afterBox = await after.boundingBox();
  if (!box || !afterBox) throw new Error("The menu's Delete or the Entry after it is not drawn.");
  expect(box.y + box.height / 2).toBeGreaterThan(afterBox.y);

  // Pressed where the pointer is, as a person's press lands: whatever is drawn on top takes it.
  const deleting = page.waitForResponse(/\/tools\/delete_entry$/);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Its toolbar stays shown while its menu is open, with the pointer gone from the Entry.
  await expect(toolbar).toHaveCSS("opacity", "1");
  await page.mouse.down();
  await page.mouse.up();
  expect((await (await deleting).json()).ok).toBe(true);

  await expect(entry).toHaveCount(0);
  const { items } = await callContextTool(page, id, "list_trash", {});
  expect(items.map((each: { record: { id: string } }) => each.record.id)).toContain(deleted?.id);
  await expect(after).toHaveCount(1);
  await expect(journal.getByText(/^Following up/)).toHaveCount(0);
});

test("on a touch screen, an Entry's one button opens a menu of its six actions", async ({
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
    "Add a Task",
    "Follow up",
    "Mark Standing",
    "Move",
    "Delete",
  ]);
  // Put away with a tap on it again, and opened once more, as the accessibility check sees it.
  await button.click();
  await expect(menu).toHaveCount(0);
  await button.click();
  await expect(menu.getByRole("menuitem")).toHaveCount(6);
});

test("on a touch screen, the newest Entry's menu opens over its button and shows all six actions", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "A desktop's pointer hovers, and has the toolbar.");
  // Enough Entries to fill the column, so the newest is at its foot, beside the composer.
  const older = Array.from({ length: 10 }, (_, at) => `Older than it ${at + 1}`);
  const { shown } = await journalWith(page, testInfo, [...older, "Newest of all"]);
  const entry = shown("Newest of all");
  const name = "Actions for this Entry";
  const button = entry.getByRole("button", { name, exact: true });

  // With no room under its button, at the foot of the column, the menu opens over it, each of its
  // actions in view and none cut off by the column.
  await button.click();
  const menu = entry.getByRole("menu", { name, exact: true });
  const actions = ["Edit", "Add a Task", "Follow up", "Mark Standing", "Move", "Delete"];
  await expect(menu.getByRole("menuitem")).toHaveText(actions);
  for (const action of actions) {
    await expect(menu.getByRole("menuitem", { name: action, exact: true })).toBeInViewport({
      ratio: 1,
    });
  }
  const [menuBox, buttonBox] = [await menu.boundingBox(), await button.boundingBox()];
  if (!menuBox || !buttonBox) throw new Error("The menu or its button is not drawn.");
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(buttonBox.y);

  // The focus moves into it as it opens, and Escape puts it away, the focus back on its button.
  await expect(menu.getByRole("menuitem", { name: "Edit", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();

  // A tap outside puts it away too.
  await button.click();
  await expect(menu.getByRole("menuitem")).toHaveCount(6);
  await shown("Older than it 10").getByTestId("words").click();
  await expect(menu).toHaveCount(0);

  // Opened once more, as the accessibility check sees it.
  await button.click();
  await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).toBeInViewport({
    ratio: 1,
  });
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
