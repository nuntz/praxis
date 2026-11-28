import type { Page } from "@playwright/test";
import {
  callContextTool,
  contextOfOwn,
  expect,
  makeContext,
  onPhone,
  openJournal,
  openSettings,
  screenKept,
  switchTo,
  test,
} from "./fixtures.ts";

// Settings is a screen of its own, at /settings, each section at its own address (section 8.6). It
// takes the main screen's place, and Back or Escape returns to the main screen as it was left.

/** Each section's name as the screen shows it, and its address. */
const SECTIONS = [
  ["General", "general"],
  ["Brief and Review", "brief-and-review"],
  ["Standing Entries", "standing"],
  ["Changes", "changes"],
  ["Trash", "trash"],
  ["Conversation and search", "conversation-and-search"],
  ["Contexts", "contexts"],
  ["Connections", "connections"],
  ["Devices", "devices"],
  ["Spend", "spend"],
  ["Backups and Export", "backups"],
] as const;

const sections = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });
const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const gear = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "Settings", exact: true });

test("the gear opens Settings at its address: General on a desktop, the list of sections on a phone", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Kept");
  await page.goto("/");
  await gear(page).click();

  await expect(page).toHaveURL("/settings");
  await expect(sections(page)).toBeVisible();
  // The main screen is put away while Settings shows.
  await expect(page.getByRole("region", { name: "Attention", exact: true })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Columns" })).toBeHidden();
  for (const [name] of SECTIONS) {
    await expect(sections(page).getByRole("link", { name, exact: true })).toBeVisible();
  }
  if (onPhone(testInfo)) {
    await expect(section(page, "General")).toBeHidden();
  } else {
    await expect(section(page, "General")).toBeVisible();
    await expect(
      sections(page).getByRole("link", { name: "General", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("each section opens at its own address and survives a reload, and an unknown one shows General", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Kept");
  for (const [name, address] of SECTIONS) {
    await page.goto("/settings");
    await sections(page).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(`/settings/${address}`);
    await expect(section(page, name)).toBeVisible();
    await page.reload();
    await expect(section(page, name)).toBeVisible();
    await expect(page).toHaveURL(`/settings/${address}`);
  }

  await page.goto("/settings/nowhere");
  await expect(section(page, "General")).toBeVisible();
  // Opened at its address, Settings has the main screen behind it.
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("region", { name: "Attention", exact: true })).toBeVisible();
});

test("the browser's Back and forward move between the main screen, Settings and its sections", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Kept");
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  await gear(page).click();
  await expect(page).toHaveURL("/settings");
  await sections(page).getByRole("link", { name: "Spend", exact: true }).click();
  await expect(page).toHaveURL("/settings/spend");
  await expect(section(page, "Spend")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL("/settings");
  await expect(section(page, "Spend")).toBeHidden();
  if (onPhone(testInfo)) await expect(sections(page)).toBeVisible();
  else await expect(section(page, "General")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(journal).toBeVisible();
  await expect(sections(page)).toBeHidden();

  await page.goForward();
  await expect(page).toHaveURL("/settings");
  await expect(sections(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL("/settings/spend");
  await expect(section(page, "Spend")).toBeVisible();
});

test("Back or Escape from Settings returns to the main screen as it was left: its tab, its scroll and both drafts", async ({
  page,
}, testInfo) => {
  const { id, name } = await contextOfOwn(page, testInfo, "Kept");
  // More Entries than the Journal shows at once, so it scrolls.
  for (let n = 1; n <= 30; n++) {
    await callContextTool(page, id, "record_entry", { words: `Kept in place ${n}` });
  }
  await page.goto("/");
  const conversation = page.getByRole("region", { name: "Conversation", exact: true });
  const tabs = page.getByRole("navigation", { name: "Columns" });
  if (onPhone(testInfo)) await tabs.getByRole("button", { name: "Agent", exact: true }).click();
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill("Half a question");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill("Half a thought");
  const entry = journal.getByTestId("entry").filter({ hasText: "Kept in place 15" });
  await expect(entry).toHaveCount(1);
  // Scrolled away from either end, so a column put back at its start or its end is told apart.
  await entry.evaluate((shown) => shown.scrollIntoView({ block: "start" }));
  const at = (await entry.boundingBox())?.y;
  if (at === undefined) throw new Error("The Entry is not shown");

  /** The main screen as it was left. */
  async function asLeft() {
    await expect(page).toHaveURL("/");
    await expect(sections(page)).toBeHidden();
    await expect(composer).toHaveValue("Half a thought");
    await expect.poll(async () => (await entry.boundingBox())?.y).toBe(at);
    if (onPhone(testInfo)) {
      await expect(tabs.getByRole("button", { name: "Journal", exact: true })).toHaveAttribute(
        "aria-current",
        "true",
      );
    }
  }

  await gear(page).click();
  await expect(sections(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await asLeft();

  await gear(page).click();
  await sections(page).getByRole("link", { name: "Trash", exact: true }).click();
  await expect(section(page, "Trash")).toBeVisible();
  await page.keyboard.press("Escape");
  await asLeft();

  await gear(page).click();
  await sections(page).getByRole("link", { name: "Devices", exact: true }).click();
  const banner = page.getByRole("banner");
  if (onPhone(testInfo)) {
    await banner.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(sections(page)).toBeVisible();
    await banner.getByRole("link", { name: "Done", exact: true }).click();
  } else {
    await banner.getByRole("link", { name: `Back to ${name}`, exact: true }).click();
  }
  await asLeft();

  await gear(page).click();
  await expect(sections(page)).toBeVisible();
  await page.goBack();
  await asLeft();

  if (onPhone(testInfo)) await tabs.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(
    conversation.getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true }),
  ).toHaveValue("Half a question");
});

test("opening a section puts the focus on its heading, and on a phone going back to the list puts it on the row that was left, by keyboard and by tap", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Kept");
  await page.goto("/settings");
  const link = (name: string) => sections(page).getByRole("link", { name, exact: true });
  const heading = (name: string) =>
    section(page, name).getByRole("heading", { level: 2, name, exact: true });
  const toList = page.getByRole("banner").getByRole("link", { name: "Settings", exact: true });

  // By tap, or a click where there is a pointer.
  if (onPhone(testInfo)) await link("Spend").tap();
  else await link("Spend").click();
  await expect(heading("Spend")).toBeFocused();

  if (onPhone(testInfo)) {
    await toList.tap();
    await expect(link("Spend")).toBeFocused();
  }

  // By keyboard.
  await link("Devices").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/settings/devices");
  await expect(heading("Devices")).toBeFocused();

  if (onPhone(testInfo)) {
    await toList.focus();
    await page.keyboard.press("Enter");
    await expect(link("Devices")).toBeFocused();
    // The browser's Back, from a section opened from the list.
    await link("Contexts").focus();
    await page.keyboard.press("Enter");
    await expect(heading("Contexts")).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL("/settings");
    await expect(link("Contexts")).toBeFocused();
  } else {
    // On a desktop the browser's Back opens the section before, and its heading takes the focus.
    await page.goBack();
    await expect(page).toHaveURL("/settings/spend");
    await expect(heading("Spend")).toBeFocused();
  }

  // The Trash and the Changes open as every other section does.
  for (const name of ["Trash", "Changes"]) {
    if (onPhone(testInfo)) await link(name).tap();
    else await link(name).click();
    await expect(heading(name)).toBeFocused();
    if (onPhone(testInfo)) {
      await toList.tap();
      await expect(link(name)).toBeFocused();
    }
  }
});

test("a change that cannot be made is said once, under the box of the group it came from, and goes once one is", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Kept");
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");
  const brief = settings.getByRole("group", { name: "Brief, each day", exact: true });
  const dailyBrief = brief.getByRole("switch", { name: "Daily Brief" });
  await expect(dailyBrief).toBeChecked();

  await page.context().setOffline(true);
  await dailyBrief.click();
  await expect(brief.getByRole("alert")).toHaveText(
    "Praxis could not be reached: this needs the network.",
  );
  await expect(settings.getByRole("alert")).toHaveCount(1);
  // The switch is put back as it was: nothing changed.
  await expect(dailyBrief).toBeChecked();

  await page.context().setOffline(false);
  const turned = page.waitForResponse(/\/tools\/set_brief_time$/);
  await dailyBrief.click();
  expect((await (await turned).json()).ok).toBe(true);
  await expect(dailyBrief).not.toBeChecked();
  await expect(settings.getByRole("alert")).toHaveCount(0);
});

test("Brief and Review's Notifications lead to Devices, which opens with its heading focused", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Kept");
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");
  await settings
    .getByRole("group", { name: "Notifications", exact: true })
    .getByRole("link", { name: "in Devices", exact: true })
    .click();
  await expect(page).toHaveURL("/settings/devices");
  await expect(
    section(page, "Devices").getByRole("heading", { level: 2, name: "Devices", exact: true }),
  ).toBeFocused();
});

test("switching Context in Settings' top bar shows that Context's sections", async ({
  page,
}, testInfo) => {
  const first = await contextOfOwn(page, testInfo, "Kept", "UTC");
  const second = await makeContext(page, {
    name: `Other ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "Asia/Tokyo",
    accent: "plum",
  });
  await page.goto("/settings/general");
  const general = section(page, "General");
  await expect(general.getByRole("combobox", { name: "This Context", exact: true })).toHaveValue(
    "UTC",
  );
  await expect(general).toContainText(first.name);

  await switchTo(page, second.name);

  await expect(page).toHaveURL("/settings/general");
  await expect(general.getByRole("combobox", { name: "This Context", exact: true })).toHaveValue(
    "Asia/Tokyo",
  );
  await expect(general).toContainText(second.name);
  await expect(general).not.toContainText(first.name);
});

test("a Settings address opened with no network shows Settings from the screen the service worker kept", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Kept");
  await page.goto("/");
  await expect(gear(page)).toBeVisible();
  await screenKept(page);

  await page.context().setOffline(true);
  await page.goto("/settings/devices");

  await expect(page).toHaveURL("/settings/devices");
  await expect(section(page, "Devices")).toBeVisible();
  await page.context().setOffline(false);
});
