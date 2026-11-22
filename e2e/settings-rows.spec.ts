import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  callDeploymentTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openSettings,
  test,
} from "./fixtures.ts";

// Settings' look (section 8.6): each section's settings are rows in grouped boxes, the words on
// the left and the control on the right, and every on/off setting is a switch, never a checkbox.

/** A Context of this journey's own, shown on opening. */
async function contextOfOwn(page: Page, testInfo: TestInfo) {
  const made = await makeContext(page, {
    name: `Rows ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, made.id);
  return made;
}

/**
 * The control sits to the right of the words that name it, in its row. Both are measured at once,
 * and again until they agree, since what a section reads as it opens can move the row between two
 * measures.
 */
async function besideItsWords(words: Locator, control: Locator) {
  await expect
    .poll(async () => {
      const [named, shown] = await Promise.all([words.boundingBox(), control.boundingBox()]);
      if (!named || !shown) return "not shown";
      if (shown.x <= named.x + named.width) return "the control is not right of its words";
      // On the same row: the control's middle lies within the words' height, give or take its own.
      const middle = shown.y + shown.height / 2;
      const sameRow =
        middle > named.y - shown.height && middle < named.y + named.height + shown.height;
      return sameRow ? "beside" : "the control is not on its words' row";
    })
    .toBe("beside");
}

/** Turn a switch as the person does: with Space from the keyboard, or with a tap or a click. */
async function turn(page: Page, toggle: Locator, how: "space" | "tap", testInfo: TestInfo) {
  if (how === "space") {
    await toggle.focus();
    await page.keyboard.press("Space");
  } else if (onPhone(testInfo)) {
    await toggle.tap();
  } else {
    await toggle.click();
  }
}

test("Brief and Review shows each time with its switch, and the Notification switch, in grouped rows", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo);
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");

  const brief = settings.getByRole("group", { name: "Brief, each day", exact: true });
  const review = settings.getByRole("group", { name: "Review, each week", exact: true });
  const notifying = settings.getByRole("group", { name: "Notifications", exact: true });

  const dailyBrief = brief.getByRole("switch", { name: "Daily Brief" });
  await expect(dailyBrief).toBeChecked();
  await expect(brief.getByLabel("Time", { exact: true })).toHaveValue("07:00");
  await besideItsWords(brief.getByText("Daily Brief", { exact: true }), dailyBrief);

  const weeklyReview = review.getByRole("switch", { name: "Weekly Review" });
  await expect(weeklyReview).toBeChecked();
  await expect(review.getByRole("combobox", { name: "Day", exact: true })).toHaveValue("sunday");
  await expect(review.getByLabel("Time", { exact: true })).toHaveValue("17:00");
  await besideItsWords(review.getByText("Weekly Review", { exact: true }), weeklyReview);

  const notifications = notifying.getByRole("switch", {
    name: /^Tell my Devices when the Brief or the Review is ready/,
  });
  await expect(notifications).toBeChecked();
  await besideItsWords(
    notifying.getByText("Tell my Devices when the Brief or the Review is ready", { exact: true }),
    notifications,
  );

  // No on/off setting is a checkbox.
  await expect(settings.getByRole("checkbox")).toHaveCount(0);
});

test("each switch in Brief and Review turns with Space and with a tap", async ({
  page,
}, testInfo) => {
  const { id } = await contextOfOwn(page, testInfo);
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");

  const switches = [
    ["Daily Brief", "set_brief_time", { brief_time: null }, { brief_time: "07:00" }],
    ["Weekly Review", "set_review_time", { review_time: null }, { review_time: "17:00" }],
    [
      /^Tell my Devices when the Brief or the Review is ready/,
      "set_notifications",
      { notifications: false },
      { notifications: true },
    ],
  ] as const;

  for (const [name, tool, off, on] of switches) {
    const toggle = settings.getByRole("switch", { name });
    for (const [how, kept, checked] of [
      ["space", off, false],
      ["tap", on, true],
    ] as const) {
      const sent = page.waitForResponse((response) =>
        response.url().endsWith(`/api/contexts/${id}/tools/${tool}`),
      );
      await turn(page, toggle, how, testInfo);
      await sent;
      if (checked) await expect(toggle).toBeChecked();
      else await expect(toggle).not.toBeChecked();
      // What the server kept, read back as the screen reads it.
      expect(await callContextTool(page, id, "get_settings", {})).toMatchObject(kept);
    }
  }
});

test("on a phone the list of sections shows each one's current value, where it is known", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "the list of sections is a screen of its own on a phone only");
  const { id } = await makeContext(page, {
    name: `Valued ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "America/Argentina/Buenos_Aires",
    accent: "rust",
  });
  // One Standing Entry, and one Entry in the Trash.
  const standing = await callContextTool(page, id, "record_entry", { words: "Kept in mind" });
  await callContextTool(page, id, "mark_standing", { id: standing.record.id });
  const trashed = await callContextTool(page, id, "record_entry", { words: "Thrown away" });
  await callContextTool(page, id, "delete_entry", { id: trashed.record.id });
  await lastShown(page, id);
  await page.goto("/settings");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  const row = (name: string) => sections.getByRole("link", { name, exact: true });

  // The value is read out after the section's name, which stays its name.
  await expect(row("General")).toHaveAccessibleDescription("Buenos Aires");
  await expect(row("General")).toContainText("Buenos Aires");
  // The Brief's time and the Review's day, as a new Context has them.
  await expect(row("Brief and Review")).toHaveAccessibleDescription(/^7:00\sAM · Sun$/);
  await expect(row("Standing Entries")).toHaveAccessibleDescription("1");
  await expect(row("Trash")).toHaveAccessibleDescription("1");
  await expect(row("Spend")).toHaveAccessibleDescription(/^\$[\d,]+\.\d\d of \$[\d,]+\.\d\d$/);
  await expect(row("Contexts")).toHaveAccessibleDescription(/^\d+$/);
  // Every journey's Connections and Devices are the Deployment's, so only their count is known.
  await expect(row("Connections")).toHaveAccessibleDescription(/^\d+$/);
  await expect(row("Devices")).toHaveAccessibleDescription(/^\d+$/);
  // The day of the last Backup on the Device, as the Deployment last answered, or that none was
  // made.
  const { made_at } = await callDeploymentTool(page, "get_last_backup", {});
  await expect(row("Backups and Export")).toHaveAccessibleDescription(
    made_at === null
      ? "None"
      : await page.evaluate(
          (at) =>
            new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
              Date.parse(at),
            ),
          made_at as string,
        ),
  );
  // A section with no value to show says none.
  await expect(row("Changes")).toHaveAccessibleDescription("");
  await expect(row("Conversation and search")).toHaveAccessibleDescription("");

  // Emptied, the Trash says so.
  await callContextTool(page, id, "empty_trash", {});
  await page.reload();
  await expect(row("Trash")).toHaveAccessibleDescription("Empty");

  // With the Brief switched off, the Review's day is all there is to show.
  await callContextTool(page, id, "set_brief_time", { time: null });
  await page.reload();
  await expect(row("Brief and Review")).toHaveAccessibleDescription("Sun");
  await callContextTool(page, id, "set_review_time", { time: null });
  await page.reload();
  await expect(row("Brief and Review")).toHaveAccessibleDescription("Off");
});

test("this Device's Offline Copy is a switch in Devices, turned with Space and with a tap", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo);
  await page.goto("/");
  const devices = await openSettings(page, "Devices");
  const here = devices.getByRole("group", { name: "This Device", exact: true });

  const copy = here.getByRole("switch", { name: "Offline Copy on this Device", exact: true });
  await expect(copy).not.toBeChecked();
  await besideItsWords(here.getByText("Offline Copy on this Device", { exact: true }), copy);
  // The Deployment the journeys run against has no key to send Notifications with, so this
  // Device's Notifications say so, in their row, with no switch.
  await expect(here).toContainText("Notifications on this Device");
  await expect(here.getByText(/no key to send Notifications with/)).toBeVisible();

  for (const [how, on] of [
    ["space", true],
    ["tap", false],
  ] as const) {
    const switched = page.waitForResponse(/\/tools\/set_device_offline_copy$/);
    await turn(page, copy, how, testInfo);
    expect((await (await switched).json()).ok).toBe(true);
    if (on) await expect(copy).toBeChecked();
    else await expect(copy).not.toBeChecked();
  }
  await expect(devices.getByRole("checkbox")).toHaveCount(0);
});

test("a Connection's Reading only is a switch, in the new Connection's form too", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo);
  await page.goto("/");
  const connections = await openSettings(page, "Connections");
  const form = connections.getByRole("form", { name: "New Connection" });

  const readingOnly = form.getByRole("switch", { name: "Reading only", exact: true });
  await expect(readingOnly).not.toBeChecked();
  await besideItsWords(form.getByText("Reading only", { exact: true }), readingOnly);
  await turn(page, readingOnly, "space", testInfo);
  await expect(readingOnly).toBeChecked();
  await turn(page, readingOnly, "tap", testInfo);
  await expect(readingOnly).not.toBeChecked();
  await expect(connections.getByRole("checkbox")).toHaveCount(0);
});
