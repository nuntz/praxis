import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  closeSettings,
  contextOfOwn,
  expect,
  openJournal,
  openSettings,
  test,
} from "./fixtures.ts";

// A Context's time zone is picked from the browser's list of IANA zones, narrowed as the person
// types, each said with its offset now: in General, and when the Context is made (section 3.1).
// Tokyo is 9 hours ahead of UTC all year, a zone neither project's Device is in.

const PICKED = "Asia/Tokyo";

/** The Device's zone, which the project gives it. */
function deviceZone(testInfo: TestInfo): string {
  return testInfo.project.use.timezoneId as string;
}

/** How the Device's locale writes an instant's time of day in a zone, as an Entry says it. */
function timeIn(page: Page, at: number, zone: string) {
  return page.evaluate(
    ([instant, timeZone]) =>
      new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone }).format(instant),
    [at, zone] as const,
  );
}

test("General sets a Context's time zone from a list narrowed as it is typed, and its times follow", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Zoned");
  const tag = crypto.randomUUID().slice(0, 8);
  // An hour ago, on the minute, so its time of day is told apart in each zone.
  const at = Math.floor((Date.now() - 60 * 60 * 1000) / 60_000) * 60_000;
  await callContextTool(page, context.id, "record_entry", {
    words: `Called the landlord ${tag}`,
    made_at: new Date(at).toISOString(),
  });
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const time = journal
    .getByTestId("entry")
    .filter({ hasText: `Called the landlord ${tag}` })
    .getByRole("time");
  await expect(time).toHaveText(await timeIn(page, at, "UTC"));

  const general = await openSettings(page, "General");
  const field = general.getByRole("combobox", { name: "This Context", exact: true });
  await expect(field).toHaveValue("UTC");
  // Reached by the keyboard: it comes before the shortcut to this Device's zone.
  const device = deviceZone(testInfo);
  const shortcut = general.getByRole("button", { name: `Use ${device}`, exact: true });
  await shortcut.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(field).toBeFocused();

  await page.keyboard.type("toky");
  const zones = general.getByRole("listbox", { name: "Time zones", exact: true });
  await expect(field).toHaveAttribute("aria-expanded", "true");
  // Each zone is said by its name and its offset now.
  await expect(zones.getByRole("option")).toHaveText([/^Asia\/Tokyo\s*UTC\+09:00$/]);
  await expect(zones.getByRole("option").first()).toHaveAttribute("aria-selected", "true");

  const sent = page.waitForResponse(/\/tools\/set_time_zone$/);
  await page.keyboard.press("Enter");
  expect((await (await sent).json()).ok).toBe(true);
  await expect(zones).toHaveCount(0);
  await expect(field).toHaveValue(PICKED);
  await expect(field).toBeFocused();
  // Picked by hand, the zone is the Context's, and this Device's is still offered beside it.
  const settings = await callContextTool(page, context.id, "get_settings", {});
  expect(settings.time_zone).toBe(PICKED);
  await expect(general.getByTestId("device-time-zone")).toHaveText(device);
  await expect(shortcut).toBeVisible();

  // The Journal's times are in the zone picked.
  await closeSettings(page);
  await openJournal(page, testInfo);
  await expect(time).toHaveText(await timeIn(page, at, PICKED));
});

test("Escape puts the list of time zones away and the field back to the Context's zone, and the arrow brings the whole list", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Zoned");
  await page.goto("/settings/general");
  const general = page.getByRole("region", { name: "General", exact: true });
  const field = general.getByRole("combobox", { name: "This Context", exact: true });
  const zones = general.getByRole("listbox", { name: "Time zones", exact: true });
  await expect(field).toHaveValue("UTC");

  // Typed with spaces for the name's underscores, as a city is said.
  await field.fill("buenos aires");
  await expect(zones.getByRole("option")).toHaveText([
    // The browser may know it by its older name.
    /^America\/(Argentina\/)?Buenos_Aires\s*UTC-03:00$/,
  ]);
  await page.keyboard.press("Escape");
  await expect(zones).toHaveCount(0);
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect(field).toHaveValue("UTC");
  // The Escape was the list's: Settings stays.
  await expect(page).toHaveURL("/settings/general");
  await expect(field).toBeFocused();

  // Nothing typed, the arrow lists every zone, the Context's own the one highlighted.
  await page.keyboard.press("ArrowDown");
  await expect(zones).toBeVisible();
  expect(await zones.getByRole("option").count()).toBeGreaterThan(300);
  const own = zones.getByRole("option", { name: /^UTC\s*UTC$/ });
  await expect(own).toHaveAttribute("aria-selected", "true");
  await expect(own).toBeInViewport();
  const ownId = await own.getAttribute("id");
  if (ownId === null) throw new Error("The highlighted zone has no id to be told by");
  await expect(field).toHaveAttribute("aria-activedescendant", ownId);
});

test("a new Context's time zone is picked from the same list, starting at this Device's", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Zoned");
  const name = `Tokyo ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  const contexts = await openSettings(page, "Contexts");
  const opening = contexts.getByRole("button", { name: "New Context…", exact: true });
  await opening.click();
  const form = contexts.getByRole("form", { name: "New Context" });
  const field = form.getByRole("combobox", { name: "Time zone", exact: true });
  await expect(field).toHaveValue(deviceZone(testInfo));

  await form.getByLabel("Name", { exact: true }).fill(name);
  await field.fill("tokyo");
  await form.getByRole("option", { name: /^Asia\/Tokyo/ }).click();
  await expect(field).toHaveValue(PICKED);
  await form.getByRole("button", { name: "Make the Context" }).click();

  await expect(
    page.getByRole("banner").getByRole("button", { name: /^Context: / }),
  ).toHaveAccessibleName(`Context: ${name}`);
  // Made, the form closes, and opened again it starts at this Device's zone.
  await expect(form).toHaveCount(0);
  await opening.click();
  await expect(field).toHaveValue(deviceZone(testInfo));
  const general = page.getByRole("region", { name: "General", exact: true });
  await page.goto("/settings/general");
  await expect(general.getByRole("combobox", { name: "This Context", exact: true })).toHaveValue(
    PICKED,
  );
});
