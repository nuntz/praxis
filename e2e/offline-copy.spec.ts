import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  callDeploymentTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  return page.getByRole("region", { name: "Devices", exact: true });
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
  await devices.getByRole("button", { name: "Keep an Offline Copy here", exact: true }).click();
  await expect(
    devices.getByRole("button", { name: "Switch off the Offline Copy here", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const held = await contextsHeld(page);
      return contexts.filter((id) => !held.includes(id));
    })
    .toEqual([]);
  return devices;
}

/** Switch to another Context from the top bar. */
async function switchTo(page: Page, name: string) {
  const switcher = page.getByRole("banner").getByRole("button", { name: /^Context: / });
  await switcher.click();
  await page.getByRole("list", { name: "Contexts" }).getByRole("button", { name }).click();
  await expect(switcher).toHaveAccessibleName(`Context: ${name}`);
}

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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  // A Context switched to is fetched into the copy at once, if it holds nothing of it yet.
  await switchTo(page, away.name);
  await expect.poll(() => contextsHeld(page)).toContain(away.id);
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
  await entry.getByRole("button", { name: "Follow up", exact: true }).click();
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("This Context's settings and its Trash need the network.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Standing Entries" })).toContainText(
    `Always ask first ${tag}`,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();

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
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  // The network fails on the way, so the Entry stays Unsent though the Device is online.
  await page.route(/\/tools\/record_entry$/, (route) => route.abort());
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill("Kept through the switch");
  await journal.getByRole("button", { name: "Record", exact: true }).click();
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);

  const devices = await openDevices(page);
  await devices
    .getByRole("button", { name: "Switch off the Offline Copy here", exact: true })
    .click();
  const question = devices.getByRole("group");
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
  await expect(
    devices.getByRole("button", { name: "Keep an Offline Copy here", exact: true }),
  ).toBeVisible();
  const { items } = await callDeploymentTool(page, "list_devices", {});
  expect(items.filter((device: { id: string }) => device.id === here)).toEqual([]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
