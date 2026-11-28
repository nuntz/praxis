import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  callDeploymentTool,
  contextOfOwn,
  expect,
  holdNext,
  lastShown,
  makeContext,
  onPhone,
  openSettings,
  showSection,
  test,
} from "./fixtures.ts";

// Settings' look (section 8.6): each section's settings are rows in grouped boxes, the words on
// the left and the control on the right, and every on/off setting is a switch, never a checkbox.

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
  await contextOfOwn(page, testInfo, "Rows");
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

/**
 * Where a switch's knob lies across its pill, from the pill's left edge, as drawn once it has
 * finished moving: its `::after`, placed by `left` and moved by its transform.
 */
async function knobAcross(toggle: Locator) {
  return toggle.evaluate((pill) => {
    const knob = getComputedStyle(pill, "::after");
    const moved = knob.transform === "none" ? 0 : new DOMMatrix(knob.transform).m41;
    const start = Number.parseFloat(knob.left) + moved;
    return { start, end: start + Number.parseFloat(knob.width), pill: pill.clientWidth };
  });
}

test("a switch's knob lies inside its pill, on and off", async ({ page }, testInfo) => {
  await contextOfOwn(page, testInfo, "Rows");
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");
  const toggle = settings.getByRole("switch", { name: "Daily Brief" });

  for (const on of [true, false]) {
    if (on) await expect(toggle).toBeChecked();
    else await expect(toggle).not.toBeChecked();
    // Inside the pill with room to spare each side, the knob at the end its state puts it.
    await expect
      .poll(async () => {
        const { start, end, pill } = await knobAcross(toggle);
        if (start < 2 || end > pill - 2) return `outside its pill: ${start} to ${end} in ${pill}`;
        return (on ? pill - end : start) <= 4 ? "inside, at its end" : "not at its end";
      })
      .toBe("inside, at its end");
    const sent = page.waitForResponse(/\/tools\/set_brief_time$/);
    await turn(page, toggle, "tap", testInfo);
    await sent;
  }
});

test("on a phone, a section's groups sit on the 16px side gutter and its fields are 44px high", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "the side gutter and the 44px Rule are the phone's");
  await contextOfOwn(page, testInfo, "Rows");
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");
  const width = page.viewportSize()?.width ?? 0;

  for (const name of ["Brief, each day", "Review, each week", "Notifications"]) {
    const group = await settings.getByRole("group", { name, exact: true }).boundingBox();
    expect(group?.x, name).toBeCloseTo(16, 0);
    expect((group?.x ?? 0) + (group?.width ?? 0), name).toBeCloseTo(width - 16, 0);
  }
  const fields = settings.locator("input:not(.switch), select");
  expect(await fields.count()).toBeGreaterThan(0);
  for (const field of await fields.all()) {
    expect((await field.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("on a desktop, the section shown is on inset in ink in the sidebar, under a Column title, its fields edged at 3:1", async ({
  page,
}, testInfo) => {
  test.skip(
    onPhone(testInfo),
    "the sidebar and the top bar's title beside a section are a desktop's",
  );
  await contextOfOwn(page, testInfo, "Rows");
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");

  // A selected state never takes the accent (the One Accent Rule): inset, in ink, its icon too.
  const shown = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Brief and Review", exact: true });
  await expect(shown).toHaveAttribute("aria-current", "page");
  await expect(shown).toHaveCSS("background-color", "rgb(244, 245, 248)");
  await expect(shown).toHaveCSS("color", "rgb(26, 29, 35)");
  await expect(shown.locator("svg").first()).toHaveCSS("color", "rgb(26, 29, 35)");

  // Under the top bar's "Settings", at Screen title, the section's own heading is a step down.
  await expect(page.getByRole("banner").getByRole("heading", { name: "Settings" })).toHaveCSS(
    "font-size",
    "26px",
  );
  await expect(settings.getByRole("heading", { name: "Brief and Review" })).toHaveCSS(
    "font-size",
    "20px",
  );

  // An empty field's edge is a 1px ring in `edge`, 3:1 on surface where `rule` is not.
  const time = settings
    .getByRole("group", { name: "Brief, each day", exact: true })
    .getByLabel("Time", { exact: true });
  await expect(time).toHaveCSS("box-shadow", "rgb(134, 141, 154) 0px 0px 0px 1px inset");
});

test("each switch in Brief and Review turns with Space and with a tap", async ({
  page,
}, testInfo) => {
  const { id } = await contextOfOwn(page, testInfo, "Rows");
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

test("a Review time left for its Day is sent first, and the Day picked meanwhile lands with it", async ({
  page,
}, testInfo) => {
  const { id } = await contextOfOwn(page, testInfo, "Rows");
  await page.goto("/");
  const settings = await openSettings(page, "Brief and Review");
  const review = settings.getByRole("group", { name: "Review, each week", exact: true });
  const time = review.getByLabel("Time", { exact: true });
  const day = review.getByRole("combobox", { name: "Day", exact: true });

  // The time is sent as its field is left for the Day, and its answer is held while the Day is
  // picked: the Day waits for nothing, and goes with the time just sent, never the one before.
  const answer = await holdNext(page, new RegExp(`/api/contexts/${id}/tools/set_review_time$`));
  await time.fill("18:30");
  await time.press("Shift+Tab");
  await answer.asked();
  await expect(day).toBeFocused();
  await day.selectOption("friday");
  await answer.release();

  await expect(day).toHaveValue("friday");
  await expect(time).toHaveValue("18:30");
  await expect
    .poll(() => callContextTool(page, id, "get_settings", {}))
    .toMatchObject({ review_day: "friday", review_time: "18:30" });
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
  const { record: thrown } = await callContextTool(page, id, "delete_entry", {
    id: trashed.record.id,
  });
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
  await expect(row("Contexts")).toHaveAccessibleDescription(/^[1-9]\d*$/);
  // Every journey's Connections and Devices are the Deployment's, so only their count is known: a
  // count above zero, or nothing at none.
  await expect(row("Connections")).toHaveAccessibleDescription(/^([1-9]\d*)?$/);
  await expect(row("Devices")).toHaveAccessibleDescription(/^([1-9]\d*)?$/);
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
  await callContextTool(page, id, "empty_trash", { up_to: thrown.deleted_at });
  await page.reload();
  await expect(row("Trash")).toHaveAccessibleDescription("Empty");

  // With none standing, Standing Entries shows nothing, as Connections does at none: read again
  // as the list shows again, in place of the count it showed.
  await expect(row("Standing Entries")).toHaveAccessibleDescription("1");
  await callContextTool(page, id, "unmark_standing", { id: standing.record.id });
  await row("Changes").click();
  await page.getByRole("banner").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(row("Standing Entries")).toHaveAccessibleDescription("");

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
  await contextOfOwn(page, testInfo, "Rows");
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
  await contextOfOwn(page, testInfo, "Rows");
  await page.goto("/");
  const connections = await openSettings(page, "Connections");
  await connections.getByRole("button", { name: "New Connection…", exact: true }).click();
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

/** This browser's id as a Device, kept in its storage once the screen has loaded. */
async function thisDevice(page: Page): Promise<string> {
  const id = await page.evaluate(() => localStorage.getItem("praxis.device"));
  if (id === null) throw new Error("This browser has no Device id");
  return id;
}

test("a Context's and a Connection's act lies right of its words, More beside it", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Rows");
  const name = `Agent ${crypto.randomUUID().slice(0, 8)}`;
  await callDeploymentTool(page, "create_connection", {
    name,
    context_id: context.id,
    reading_only: false,
  });
  await page.goto("/");

  // A Context shows no act of its own: More is its act.
  const contexts = await openSettings(page, "Contexts");
  const contextRow = contexts
    .getByTestId("context-row")
    .filter({ has: page.getByText(context.name, { exact: true }) });
  await expect(contextRow.getByText("Teal · Current", { exact: true })).toBeVisible();
  await besideItsWords(
    contextRow.getByText(context.name, { exact: true }),
    contextRow.getByRole("button", { name: `More for ${context.name}`, exact: true }),
  );

  // A Connection's is its Reading only switch.
  const connections = await showSection(page, "Connections");
  const connectionRow = connections
    .getByTestId("connection-row")
    .filter({ has: page.getByText(name, { exact: true }) });
  await expect(connectionRow.getByText(`in ${context.name}`, { exact: true })).toBeVisible();
  await besideItsWords(
    connectionRow.getByText(name, { exact: true }),
    connectionRow.getByRole("switch", { name: "Reading only", exact: true }),
  );
  await besideItsWords(
    connectionRow.getByText(name, { exact: true }),
    connectionRow.getByRole("button", { name: `More for ${name}`, exact: true }),
  );
});

test("a Device's Remove lies right of its words, it is renamed behind More, and removed in one tap, said in its row's place", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Rows");
  await page.goto("/");
  const devices = await openSettings(page, "Devices");
  // Listed once something is switched on here.
  const switched = page.waitForResponse(/\/tools\/set_device_offline_copy$/);
  await devices.getByRole("switch", { name: "Offline Copy on this Device", exact: true }).click();
  expect((await (await switched).json()).ok).toBe(true);

  const every = devices.getByRole("list", { name: "Every Device", exact: true });
  const row = every.getByTestId("device-row").filter({ hasText: "This Device" });
  await expect(row).toContainText(/^.+This Device · Offline Copy · Last seen \S/);
  const here = await thisDevice(page);
  const { items } = await callDeploymentTool(page, "list_devices", {});
  const named = (items as { id: string; name: string }[]).find((device) => device.id === here);
  if (!named) throw new Error("This Device is listed");
  await besideItsWords(
    row.getByText(named.name, { exact: true }),
    row.getByRole("button", { name: `Remove ${named.name}`, exact: true }),
  );

  // Renamed behind More, in its title's place.
  const name = `Desk ${crypto.randomUUID().slice(0, 8)}`;
  await row.getByRole("button", { name: `More for ${named.name}`, exact: true }).click();
  await page
    .getByRole("menu", { name: `More for ${named.name}`, exact: true })
    .getByRole("menuitem", { name: "Rename", exact: true })
    .click();
  const field = row.getByRole("textbox", { name: `Name of ${named.name}`, exact: true });
  await expect(field).toBeFocused();
  await field.fill(name);
  await row.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(row.getByText(name, { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: `More for ${name}`, exact: true })).toBeFocused();

  // Removed in one tap: a line says so in its row's place, and takes the focus.
  const removed = page.waitForResponse(/\/tools\/remove_device$/);
  await row.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
  expect((await (await removed).json()).ok).toBe(true);
  const said = every.getByRole("status");
  await expect(said).toHaveText(
    `${name} is removed. It is listed again when Notifications or an Offline Copy is switched on there.`,
  );
  await expect(said).toBeFocused();
  await expect(row).toHaveCount(0);
  await expect(
    devices.getByRole("switch", { name: "Offline Copy on this Device", exact: true }),
  ).not.toBeChecked();
  const after = await callDeploymentTool(page, "list_devices", {});
  expect(after.items.map((device: { id: string }) => device.id)).not.toContain(here);

  // It goes at the person's next act, and the Device is listed again, as switched on anew.
  const again = page.waitForResponse(/\/tools\/set_device_offline_copy$/);
  await devices.getByRole("switch", { name: "Offline Copy on this Device", exact: true }).click();
  await again;
  await expect(said).toHaveCount(0);
  await expect(row).toHaveCount(1);
});

/**
 * What in this section spills past the screen's right edge, or scrolls sideways, as
 * `e2e/phone-width.spec.ts` finds for a column.
 */
async function spills(page: Page, section: Locator) {
  const width = page.viewportSize()?.width;
  if (!width) throw new Error("The phone has a width");
  return section.evaluate((region, width) => {
    const named = (element: Element) =>
      `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
    const found: string[] = [];
    if (document.documentElement.scrollWidth > width) {
      found.push(`the page, ${document.documentElement.scrollWidth}px wide in ${width}px`);
    }
    for (const element of [region, ...region.querySelectorAll("*")]) {
      const box = element.getBoundingClientRect();
      if (box.width <= 1 && box.height <= 1) continue;
      if (box.right > width + 0.5) found.push(`${named(element)} ends at ${box.right}px`);
      // A field scrolls its own words, by design.
      if (element instanceof HTMLInputElement) continue;
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        found.push(`${named(element)} scrolls sideways`);
      }
    }
    return found;
  }, width);
}

test("at 320px, Contexts and Connections scroll nowhere sideways, with long names, one with no break in it, and their forms open", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "The narrowest width is a phone's");
  const tag = crypto.randomUUID().slice(0, 8);
  const long = await makeContext(page, {
    name: `Everything about the house on the hill, the garden and the barn ${tag}`,
    time_zone: "UTC",
    accent: "rust",
  });
  const unbroken = await makeContext(page, {
    name: `Unbroken${"x".repeat(60)}${tag}`,
    time_zone: "UTC",
    accent: "plum",
  });
  const connection = `An agent with a long name that reads the whole Journal every morning ${tag}`;
  await callDeploymentTool(page, "create_connection", {
    name: connection,
    context_id: unbroken.id,
    reading_only: true,
  });
  await lastShown(page, long.id);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  const contexts = await openSettings(page, "Contexts");
  await expect(contexts.getByText(unbroken.name, { exact: true })).toBeVisible();
  expect(await spills(page, contexts)).toEqual([]);
  // Its name's field in its title's place.
  const unbrokenRow = contexts
    .getByTestId("context-row")
    .filter({ has: page.getByText(unbroken.name, { exact: true }) });
  await unbrokenRow.getByRole("button", { name: `More for ${unbroken.name}` }).click();
  await page
    .getByRole("menu", { name: `More for ${unbroken.name}` })
    .getByRole("menuitem", { name: "Rename", exact: true })
    .click();
  await expect(contexts.getByRole("textbox", { name: `Name of ${unbroken.name}` })).toBeFocused();
  expect(await spills(page, contexts)).toEqual([]);
  await page.keyboard.press("Escape");
  await contexts.getByRole("button", { name: "New Context…", exact: true }).click();
  await expect(contexts.getByRole("form", { name: "New Context" })).toBeVisible();
  expect(await spills(page, contexts)).toEqual([]);

  const connections = await showSection(page, "Connections");
  const row = connections
    .getByTestId("connection-row")
    .filter({ has: page.getByText(connection, { exact: true }) });
  await expect(row.getByText(`in ${unbroken.name} · Reading only`)).toBeVisible();
  expect(await spills(page, connections)).toEqual([]);
  // The form's Context is picked from every Context's name, the longest included.
  await connections.getByRole("button", { name: "New Connection…", exact: true }).click();
  await expect(connections.getByRole("form", { name: "New Connection" })).toBeVisible();
  expect(await spills(page, connections)).toEqual([]);
});

test("Contexts and Connections show their one solid button only while a form is open, and Conversation and search none", async ({
  page,
}, testInfo) => {
  await contextOfOwn(page, testInfo, "Rows");
  await page.goto("/");
  /** The solid buttons shown: those with words on a fill, as only the primary is. */
  const solid = (section: Locator) =>
    section
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons
          .filter(
            (button) =>
              (button.textContent ?? "").trim() !== "" &&
              getComputedStyle(button).backgroundColor !== "rgba(0, 0, 0, 0)",
          )
          .map((button) => (button.textContent ?? "").trim()),
      );

  const contexts = await openSettings(page, "Contexts");
  expect(await solid(contexts)).toEqual([]);
  await contexts.getByRole("button", { name: "New Context…", exact: true }).click();
  expect(await solid(contexts)).toEqual(["Make the Context"]);

  const connections = await showSection(page, "Connections");
  expect(await solid(connections)).toEqual([]);
  await connections.getByRole("button", { name: "New Connection…", exact: true }).click();
  expect(await solid(connections)).toEqual(["Make the Connection"]);

  const search = await showSection(page, "Conversation and search");
  await expect(search.getByRole("button", { name: "Rebuild from the Journal" })).toBeVisible();
  await expect(search.getByRole("button", { name: "Clear the Conversation" })).toBeVisible();
  expect(await solid(search)).toEqual([]);
});
