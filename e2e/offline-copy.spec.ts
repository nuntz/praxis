import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  callDeploymentTool,
  closeSettings,
  entryAction,
  expect,
  holdNext,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  openSettings,
  switchTo,
  test,
} from "./fixtures.ts";

// The Offline Copy (section 8.8, ADR 0020): switched on per Device, a fixed set of each Context's
// Journal kept in the browser to read with no network, shown as last fetched. It holds no
// Conversation text and no image, and an Unsent Entry may follow up and link to what it holds.
// Switched off, here or elsewhere, it is cleared, and the person is asked first about any Unsent
// writes. This is the offline journey of ADR 0015 that reads the copy. Each journey makes Contexts
// of its own, so what it reads is its own.

/** A one-pixel PNG, served for an image's address so no journey reaches beyond the Worker. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** A Context of this journey's own. */
function contextOfOwn(page: Page, testInfo: TestInfo, name: string) {
  const tag = crypto.randomUUID().slice(0, 8);
  return makeContext(page, {
    name: `${name} ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "plum",
  });
}

/** The Deployment's settings, opened from the top bar, and its Devices there. */
async function openDevices(page: Page) {
  return openSettings(page, "Devices");
}

/** This Device's Offline Copy switch, in Devices. */
function offlineCopySwitch(devices: Locator) {
  return devices.getByRole("switch", { name: "Offline Copy on this Device", exact: true });
}

/** What this browser keeps as its Offline Copy, as stored. */
function keptCopy(page: Page) {
  return page.evaluate(() => localStorage.getItem("praxis.offline"));
}

/** The Contexts this browser's Offline Copy holds, by id. */
async function contextsHeld(page: Page): Promise<string[]> {
  const kept = JSON.parse((await keptCopy(page)) ?? "null") as {
    contexts: { id: string }[];
  } | null;
  if (kept === null) return [];
  return kept.contexts.map((context) => context.id);
}

/**
 * Switch the Offline Copy on here, and wait until it holds these Contexts: the shared Deployment
 * holds every journey's, which it goes on fetching, the one last shown first.
 */
async function keepCopyHere(page: Page, contexts: string[]) {
  const devices = await openDevices(page);
  await offlineCopySwitch(devices).click();
  await expect(offlineCopySwitch(devices)).toBeChecked();
  await expect
    .poll(async () => {
      const held = await contextsHeld(page);
      return contexts.filter((id) => !held.includes(id));
    })
    .toEqual([]);
  return devices;
}

/** What this browser's Offline Copy holds of a Context, as stored, or null for nothing. */
async function partOf(page: Page, context: string) {
  const kept = JSON.parse((await keptCopy(page)) ?? "null") as {
    contexts: { id: string; fetched_at: string; opened: string[]; entries: { id: string }[] }[];
  } | null;
  return kept?.contexts.find((each) => each.id === context) ?? null;
}

/** Where the copy reads a Context's Tasks. */
function tasksOf(context: string): RegExp {
  return new RegExp(`/api/contexts/${context}/tools/list_tasks$`);
}

/** Switch to another Context from the top bar. */
/** This browser's id as a Device. */
async function thisDevice(page: Page): Promise<string> {
  const id = await page.evaluate(() => localStorage.getItem("praxis.device"));
  if (id === null) throw new Error("This browser keeps no id as a Device");
  return id;
}

/** Attention, brought into view first on a phone, where another tab may be shown. */
async function openAttention(page: Page, testInfo: TestInfo) {
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Attention" })
      .click();
  }
  return page.getByRole("region", { name: "Attention", exact: true });
}

/** The Conversation, brought into view first on a phone. */
async function openConversation(page: Page, testInfo: TestInfo) {
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
  }
  return page.getByRole("region", { name: "Conversation" });
}

test("the Offline Copy is read with no network, as last fetched, in any Context, with the Conversation saying only that it needs the network", async ({
  page,
}, testInfo) => {
  const home = await contextOfOwn(page, testInfo, "Satchel");
  const away = await contextOfOwn(page, testInfo, "Harbour");
  const tag = home.name.slice(-8);
  await lastShown(page, home.id);
  // The image's host is this stand-in, which counts what the browser asks it for.
  const imagesAsked: string[] = [];
  await page.route("https://images.example/**", (route) => {
    imagesAsked.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  const task = `Renew the passport ${tag}`;
  const ana = `Ana ${tag}`;
  const words = `Passport ${tag} runs out\n[] ${task}\n\n![Map ${tag}](https://images.example/map.png)`;
  const recorded = await callContextTool(page, home.id, "record_entry", {
    words,
    tasks: [{ title: task }],
    links: [{ to: { kind: "new_person", name: ana } }],
  });
  const passport = recorded.record as { id: string; version: number };
  // Edited, so it has Versions.
  await callContextTool(page, home.id, "edit_entry", {
    id: passport.id,
    words: `${words}\nChecked the date`,
    version: passport.version,
    tasks: [],
  });
  const standing = (
    await callContextTool(page, home.id, "record_entry", { words: `Always ask first ${tag}` })
  ).record as { id: string };
  await callContextTool(page, home.id, "mark_standing", { id: standing.id });
  await callContextTool(page, away.id, "record_entry", { words: `Ferry times ${tag}` });

  await page.goto("/");
  // A Message to the Agent, whose text no Device ever stores.
  const said = `Record: Ferry booked ${tag}`;
  const conversation = await openConversation(page, testInfo);
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${home.name}`, exact: true })
    .fill(said);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages).toHaveCount(2);

  const devices = await keepCopyHere(page, [home.id]);
  await expect(devices.getByTestId("device-row").filter({ hasText: "This Device" })).toContainText(
    "Offline Copy",
  );
  await closeSettings(page);
  // A Context switched to is fetched into the copy at once, if it holds nothing of it yet.
  await switchTo(page, away.name);
  // Under load it waits behind the copy's fetch of every other journey's Contexts.
  await expect.poll(() => contextsHeld(page), { timeout: 20_000 }).toContain(away.id);
  await switchTo(page, home.name);
  // What the browser keeps holds the Journal, and no Conversation text and no image.
  const kept = await keptCopy(page);
  if (kept === null) throw new Error("No Offline Copy is kept");
  expect(kept).toContain(`Passport ${tag} runs out`);
  expect(kept).toContain(`Ferry times ${tag}`);
  expect(kept).not.toContain(said);
  // The image was shown with the network, and still the service worker kept nothing of it.
  await expect.poll(() => imagesAsked).toContain("https://images.example/map.png");
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.filter((url) => url.includes("images.example"))).toEqual([]);

  await page.context().setOffline(true);
  await page.reload();
  const askedOnline = imagesAsked.length;

  await expect(page.getByText(/^Shown from the Offline Copy, as fetched /)).toBeVisible();
  // The Conversation needs the network and shows nothing of itself.
  const offlineConversation = await openConversation(page, testInfo);
  await expect(
    offlineConversation.getByText(/^No network: the Conversation needs one\./),
  ).toBeVisible();
  await expect(offlineConversation.getByTestId("message")).toHaveCount(0);

  const attention = await openAttention(page, testInfo);
  await expect(attention.getByRole("checkbox", { name: task, exact: true })).toBeVisible();

  const { journal, composer } = await openJournal(page, testInfo);
  const entry = journal.getByTestId("entry").filter({ hasText: `Passport ${tag} runs out` });
  await expect(entry).toBeVisible();
  // Its image shows its description, and nothing is fetched for it.
  await expect(entry.getByTestId("image-line")).toHaveText(`Map ${tag}`);
  await expect(entry.getByRole("img")).toHaveCount(0);
  expect(imagesAsked).toHaveLength(askedOnline);
  await expect(journal.getByText("Older Entries need the network.", { exact: true })).toBeVisible();

  // Versions and search need the network, and say so.
  await entry.getByRole("button", { name: "Edited", exact: true }).click();
  await expect(journal.getByText("Versions need the network.", { exact: true })).toBeVisible();
  await journal.getByRole("searchbox", { name: "Search this Context", exact: true }).fill(tag);
  await expect(journal.getByText("Search needs the network.", { exact: true })).toBeVisible();
  await journal
    .getByRole("searchbox", { name: "Search this Context", exact: true })
    .press("Escape");

  // A Follow-up to an Entry the copy holds, Mentioning a Person it holds, kept Unsent.
  await (await entryAction(entry, "Follow up", testInfo)).click();
  await composer.pressSequentially(`Asked @${ana.slice(0, 3)}`);
  const persons = page.getByRole("listbox", { name: "Persons" });
  await expect(persons.getByRole("option")).toHaveText([ana]);
  await persons.getByRole("option", { name: ana, exact: true }).click();
  await journal.getByRole("button", { name: "Record", exact: true }).click();
  const unsent = journal.getByTestId("unsent-entry");
  await expect(unsent).toHaveCount(1);
  await expect(unsent.getByText(`Follows up “Passport ${tag} runs out”`)).toBeVisible();
  await expect(unsent.getByRole("list", { name: "Mentions and References" })).toHaveText(`@${ana}`);

  // The Standing Entries are the copy's; the Trash and the settings need the network.
  await openSettings(page, "Standing Entries");
  await expect(
    page.getByText("This Context's settings and its Trash need the network.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Standing Entries" })).toContainText(
    `Always ask first ${tag}`,
  );
  await closeSettings(page);

  // Another Context is read from the copy too.
  await switchTo(page, away.name);
  const there = await openJournal(page, testInfo);
  await expect(
    there.journal.getByTestId("entry").filter({ hasText: `Ferry times ${tag}` }),
  ).toBeVisible();

  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await page.context().setOffline(false);
  const sent = await answered;
  expect((await sent.json()).ok).toBe(true);
  const { items } = await callContextTool(page, home.id, "list_entries", {});
  const followUp = items.find((each: { words: string }) => each.words.startsWith(`Asked @${ana}`));
  expect(followUp).toMatchObject({
    follow_up_to: { id: passport.id },
    links: [{ kind: "mention", to: { kind: "person", summary: ana }, anchor: { start: 6 } }],
  });
});

test("switching the Offline Copy off here asks first about the Unsent writes, and clears it", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Locker");
  await lastShown(page, context.id);
  await page.goto("/");
  await keepCopyHere(page, [context.id]);
  await closeSettings(page);

  // The network fails on the way, so the Entry stays Unsent though the Device is online.
  await page.route(/\/tools\/record_entry$/, (route) => route.abort());
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill("Kept through the switch");
  await journal.getByRole("button", { name: "Record", exact: true }).click();
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);

  const devices = await openDevices(page);
  await offlineCopySwitch(devices).click();
  const question = devices.getByRole("group", { name: /^Switching off clears the Offline Copy/ });
  await expect(question).toContainText("1 Unsent write is kept here too");
  // Nothing is switched off or cleared until the person answers.
  expect(await keptCopy(page)).not.toBeNull();
  const here = await thisDevice(page);
  const before = await callDeploymentTool(page, "list_devices", {});
  expect(before.items.filter((device: { id: string }) => device.id === here)).toEqual([
    expect.objectContaining({ offline_copy: true }),
  ]);
  const switched = page.waitForResponse(/\/tools\/set_device_offline_copy$/);
  await question.getByRole("button", { name: "Keep Unsent writes", exact: true }).click();
  expect((await (await switched).json()).ok).toBe(true);

  await expect.poll(() => keptCopy(page)).toBeNull();
  await expect(offlineCopySwitch(devices)).not.toBeChecked();
  const { items } = await callDeploymentTool(page, "list_devices", {});
  expect(items.filter((device: { id: string }) => device.id === here)).toEqual([]);
  await closeSettings(page);
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);

  // Kept, it is sent once Praxis can be reached.
  await page.unroute(/\/tools\/record_entry$/);
  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  expect((await (await answered).json()).ok).toBe(true);
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(0);
});

test("a Device removed from elsewhere clears its Offline Copy on its next contact, asking first about its Unsent writes", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Valise");
  await lastShown(page, context.id);
  await page.goto("/");
  await keepCopyHere(page, [context.id]);
  await closeSettings(page);
  await page.route(/\/tools\/record_entry$/, (route) => route.abort());
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill("Written before the removal");
  await journal.getByRole("button", { name: "Record", exact: true }).click();
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);

  // Removed from another Device.
  await callDeploymentTool(page, "remove_device", { id: await thisDevice(page) });
  await page.reload();

  const question = page.getByRole("region", {
    name: "The Offline Copy was switched off for this Device",
    exact: true,
  });
  await expect(question).toContainText("1 Unsent write is kept here too");
  expect(await keptCopy(page)).not.toBeNull();
  await question.getByRole("button", { name: "Discard them too", exact: true }).click();

  await expect(question).toHaveCount(0);
  await expect.poll(() => keptCopy(page)).toBeNull();
  const shown = await openJournal(page, testInfo);
  await expect(shown.journal.getByTestId("unsent-entry")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /Unsent/ })).toHaveCount(0);
});

test("an older Entry opened while the copy is being fetched stays in it once the fetch is in", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Attic");
  const tag = context.name.slice(-8);
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const older = (
    await callContextTool(page, context.id, "record_entry", {
      words: `Kept from the summer ${tag}`,
      made_at: fortyDaysAgo,
    })
  ).record as { id: string };
  await lastShown(page, context.id);
  await page.goto("/");
  await keepCopyHere(page, [context.id]);
  await closeSettings(page);
  const first = await partOf(page, context.id);
  if (first === null) throw new Error("The copy holds nothing of the Context");
  // Older than 30 days and never opened here, it is not held.
  expect(first.entries.map((entry) => entry.id)).not.toContain(older.id);

  // Opened anew, the screen fetches the copy again: its read of the Tasks is held.
  const held = await holdNext(page, tasksOf(context.id));
  await page.reload();
  await held.asked();
  const { journal } = await openJournal(page, testInfo);
  await journal.getByRole("searchbox", { name: "Search this Context", exact: true }).fill(tag);
  await journal.getByTestId("search-hit").filter({ hasText: tag }).getByRole("link").click();
  await expect(
    journal.getByTestId("entry").filter({ hasText: `Kept from the summer ${tag}` }),
  ).toBeFocused();
  await expect.poll(async () => (await partOf(page, context.id))?.opened).toEqual([older.id]);

  await held.release();
  await expect
    .poll(async () => (await partOf(page, context.id))?.fetched_at)
    .not.toBe(first.fetched_at);
  const fetched = await partOf(page, context.id);
  expect(fetched?.opened).toEqual([older.id]);
  expect(fetched?.entries.map((entry) => entry.id)).toContain(older.id);
});

test("a copy switched off while it is being fetched stays cleared once the fetch is in", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Drawer");
  await lastShown(page, context.id);
  await page.goto("/");
  const held = await holdNext(page, tasksOf(context.id));
  const devices = await openDevices(page);
  await offlineCopySwitch(devices).click();
  await held.asked();

  const switched = page.waitForResponse(/\/tools\/set_device_offline_copy$/);
  await offlineCopySwitch(devices).click();
  expect((await (await switched).json()).ok).toBe(true);
  await expect.poll(() => keptCopy(page)).toBeNull();

  await held.release();
  expect(await keptCopy(page)).toBeNull();
});

test("a fetch that read the switch on before it was switched off here does not bring the copy back", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Cellar");
  await lastShown(page, context.id);
  await page.goto("/");
  const devices = await openDevices(page);
  await expect(offlineCopySwitch(devices)).not.toBeChecked();
  // The fetch switching on starts asks whether the switch is on: it is, and that answer is held.
  const held = await holdNext(page, /\/api\/deployment\/tools\/list_devices$/);
  await offlineCopySwitch(devices).click();
  await held.asked();

  const switched = page.waitForResponse(/\/tools\/set_device_offline_copy$/);
  await offlineCopySwitch(devices).click();
  expect((await (await switched).json()).ok).toBe(true);
  await expect.poll(() => keptCopy(page)).toBeNull();

  await held.release();
  expect(await keptCopy(page)).toBeNull();
});
