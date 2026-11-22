import type { Page } from "@playwright/test";
import {
  callContextTool,
  expect,
  holdNext,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  screenKept,
  switchTo,
  test,
} from "./fixtures.ts";

/** The manifest the installed PWA was installed from. */
async function manifestOf(page: Page) {
  return (await page.request.get("/manifest.webmanifest")).json();
}

// Two ways of opening the Journal's composer from outside Praxis (section 8.9): the home-screen
// shortcut, and the share sheet, which hands the installed PWA text and links. Neither records
// anything: what lands in the composer becomes an Entry only when the person sends it.

test("the home-screen shortcut opens straight onto the Journal's composer, in the Context last shown", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "rust" });
  await lastShown(page, work.id);
  const manifest = await manifestOf(page);
  const shortcut = manifest.shortcuts?.[0];
  expect(shortcut, "the manifest's shortcut").toMatchObject({ name: "Record an Entry" });

  await page.goto(shortcut.url);

  // On a phone the Journal's tab is shown, not Attention, and the composer has the caret.
  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: `Record an Entry in ${work.name}` });
  await expect(composer).toBeFocused();
  if (onPhone(testInfo)) await expect(journal).toBeInViewport();
  await expect(composer).toHaveValue("");
  // The address is the screen's own again, so a reload opens as Praxis does.
  await expect(page).toHaveURL("/");
  const { items } = await callContextTool(page, work.id, "list_entries", {});
  expect(items).toEqual([]);
});

/** The address the share sheet opens with what an app shares, as the manifest asks for it. */
async function sharedAt(page: Page, shared: Record<string, string>): Promise<string> {
  const manifest = await manifestOf(page);
  const target = manifest.share_target;
  // Text and links only, never files, so the share is an address with no body.
  expect(target, "the manifest's share target").toMatchObject({ method: "GET" });
  expect(target.enctype ?? "application/x-www-form-urlencoded").toBe(
    "application/x-www-form-urlencoded",
  );
  expect(target.params.files).toBeUndefined();
  const address = new URL(target.action, "http://praxis.test");
  for (const [field, given] of Object.entries(shared)) {
    address.searchParams.set(target.params[field], given);
  }
  return address.pathname + address.search;
}

test("what the share sheet shares lands in the composer as given, and is recorded only when sent", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const home = await makeContext(page, { name: `Home ${tag}`, time_zone: "UTC", accent: "moss" });
  await lastShown(page, home.id);
  // A shared link is text: Praxis fetches nothing of it.
  const fetched: string[] = [];
  await page.route("https://shared.example/**", (route) => {
    fetched.push(route.request().url());
    return route.abort();
  });

  await page.goto(
    await sharedAt(page, {
      title: `Bread recipe ${tag}`,
      text: "Rye, slow proof",
      url: "https://shared.example/rye",
    }),
  );

  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: `Record an Entry in ${home.name}` });
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(
    `Bread recipe ${tag}\nRye, slow proof\nhttps://shared.example/rye`,
  );
  await expect(page).toHaveURL("/");
  expect((await callContextTool(page, home.id, "list_entries", {})).items).toEqual([]);

  await journal.getByRole("button", { name: "Record" }).click();

  await expect(journal.getByTestId("entry").filter({ hasText: `Bread recipe ${tag}` })).toHaveCount(
    1,
  );
  const { items } = await callContextTool(page, home.id, "list_entries", {});
  expect(items.map((entry: { words: string }) => entry.words)).toEqual([
    `Bread recipe ${tag}\nRye, slow proof\nhttps://shared.example/rye`,
  ]);
  expect(fetched).toEqual([]);
});

/**
 * Stand in for the browser's launch queue, as the installed PWA has it: a launch the manifest's
 * launch handler sends to a window already open is given to the screen there, with the address it
 * was launched at, and the launch that opened the window is given too, as Chromium gives it.
 * Returns a way to launch Praxis at an address into the window open.
 */
async function installedApp(page: Page) {
  await page.addInitScript(() => {
    type Consumer = (params: { targetURL: string }) => void;
    const opened = location.href;
    let consumer: Consumer | null = null;
    const waiting: string[] = [opened];
    const give = () => {
      while (consumer) {
        const next = waiting.shift();
        if (next === undefined) return;
        consumer({ targetURL: next });
      }
    };
    // Chromium has its own queue on every page, which gives nothing outside an installed PWA.
    Object.defineProperty(window, "launchQueue", {
      value: {
        setConsumer(given: Consumer) {
          consumer = given;
          give();
        },
      },
    });
    Object.assign(window, {
      praxisLaunch(address: string) {
        waiting.push(new URL(address, location.origin).href);
        give();
      },
    });
  });
  return (address: string) =>
    page.evaluate(
      (at) => (window as unknown as { praxisLaunch(a: string): void }).praxisLaunch(at),
      address,
    );
}

test("what is shared into Praxis already open is added to the draft there, never replacing it", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const home = await makeContext(page, { name: `Home ${tag}`, time_zone: "UTC", accent: "moss" });
  await lastShown(page, home.id);
  const manifest = await manifestOf(page);
  // A share or the shortcut goes to the window open, not a new one, so its draft is there.
  expect(manifest.launch_handler).toEqual({ client_mode: "focus-existing" });
  const launch = await installedApp(page);

  await page.goto(await sharedAt(page, { text: `First ${tag}` }));
  const composer = page
    .getByRole("region", { name: "Journal" })
    .getByRole("textbox", { name: `Record an Entry in ${home.name}` });
  // The launch that opened the window is given to the screen too, and adds nothing twice.
  await expect(composer).toHaveValue(`First ${tag}`);
  await composer.pressSequentially(" and a note of mine");

  await launch(await sharedAt(page, { text: `Second ${tag}`, url: "https://shared.example/2" }));

  await expect(composer).toHaveValue(
    `First ${tag} and a note of mine\nSecond ${tag}\nhttps://shared.example/2`,
  );
  await expect(composer).toBeFocused();
  // The shortcut, launched into the window open while the person is elsewhere on the screen,
  // brings the composer back with the caret, and keeps the draft as it is.
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Attention" })
      .click();
    await expect(page.getByRole("region", { name: "Journal" })).not.toBeInViewport();
  } else {
    await page.getByRole("button", { name: "Settings", exact: true }).focus();
    await expect(composer).not.toBeFocused();
  }
  await launch(manifest.shortcuts[0].url);
  await expect(composer).toBeFocused();
  if (onPhone(testInfo)) await expect(composer).toBeInViewport();
  await expect(composer).toHaveValue(
    `First ${tag} and a note of mine\nSecond ${tag}\nhttps://shared.example/2`,
  );
  await expect(page).toHaveURL("/");
  expect((await callContextTool(page, home.id, "list_entries", {})).items).toEqual([]);
});

test("the Context the composer opens in can be changed before sending, and the draft goes with it", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const home = await makeContext(page, { name: `Home ${tag}`, time_zone: "UTC", accent: "moss" });
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "rust" });
  await lastShown(page, home.id);
  const bea = `Bea-${tag}`;

  await page.goto(await sharedAt(page, { text: `Contract draft ${tag}` }));
  let { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toHaveAccessibleName(`Record an Entry in ${home.name}`);
  await expect(composer).toHaveValue(`Contract draft ${tag}`);
  // A link picked is to a record of the Context it was picked in, so it stays there.
  await composer.pressSequentially(` for @${bea}`);
  await journal
    .getByRole("listbox", { name: "Persons" })
    .getByRole("option", { name: `New Person “${bea}”` })
    .click();

  await switchTo(page, work.name);

  ({ journal, composer } = await openJournal(page, testInfo));
  await expect(composer).toHaveAccessibleName(`Record an Entry in ${work.name}`);
  await expect(composer).toHaveValue(`Contract draft ${tag} for @${bea} `);
  await expect(journal.getByRole("status")).toContainText("links were left off");
  await journal.getByRole("button", { name: "Record" }).click();

  await expect(
    journal.getByTestId("entry").filter({ hasText: `Contract draft ${tag}` }),
  ).toHaveCount(1);
  // Sent, the draft is gone, and what was said of its links with it.
  await expect(journal.getByText("links were left off")).toHaveCount(0);
  const recorded = await callContextTool(page, work.id, "list_entries", {});
  expect(recorded.items).toEqual([
    expect.objectContaining({ words: `Contract draft ${tag} for @${bea} `, links: [] }),
  ]);
  expect((await callContextTool(page, home.id, "list_entries", {})).items).toEqual([]);
  for (const context of [home, work]) {
    expect((await callContextTool(page, context.id, "list_persons", {})).items).toEqual([]);
  }
});

test("a draft on its way when the Context is changed is not shown again in the next", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const home = await makeContext(page, { name: `Home ${tag}`, time_zone: "UTC", accent: "moss" });
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "rust" });
  await lastShown(page, home.id);
  await page.goto("/");
  let { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toHaveAccessibleName(`Record an Entry in ${home.name}`);
  await composer.fill(`Sent once ${tag}`);
  const held = await holdNext(page, /\/tools\/record_entry$/);
  await journal.getByRole("button", { name: "Record" }).click();
  await held.asked();

  await switchTo(page, work.name);
  ({ journal, composer } = await openJournal(page, testInfo));
  await expect(composer).toHaveAccessibleName(`Record an Entry in ${work.name}`);
  await held.release();

  await expect(composer).toHaveValue("");
  const { items } = await callContextTool(page, home.id, "list_entries", {});
  expect(items.map((entry: { words: string }) => entry.words)).toEqual([`Sent once ${tag}`]);
});

test("what is shared while an Entry is on its way waits for it, and is kept once it is sent", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const home = await makeContext(page, { name: `Home ${tag}`, time_zone: "UTC", accent: "moss" });
  await lastShown(page, home.id);
  const launch = await installedApp(page);
  await page.goto(await sharedAt(page, { text: `Sent first ${tag}` }));
  const journal = page.getByRole("region", { name: "Journal" });
  const composer = journal.getByRole("textbox", { name: `Record an Entry in ${home.name}` });
  await expect(composer).toHaveValue(`Sent first ${tag}`);
  const held = await holdNext(page, /\/tools\/record_entry$/);
  await journal.getByRole("button", { name: "Record" }).click();
  await held.asked();

  await launch(await sharedAt(page, { text: `Shared meanwhile ${tag}` }));
  await held.release();

  await expect(journal.getByTestId("entry").filter({ hasText: `Sent first ${tag}` })).toHaveCount(
    1,
  );
  await expect(composer).toHaveValue(`Shared meanwhile ${tag}`);
  const { items } = await callContextTool(page, home.id, "list_entries", {});
  expect(items.map((entry: { words: string }) => entry.words)).toEqual([`Sent first ${tag}`]);
});

test("the shortcut opens onto the composer with no network, as Praxis opens", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const home = await makeContext(page, { name: `Home ${tag}`, time_zone: "UTC", accent: "moss" });
  await lastShown(page, home.id);
  const { shortcuts } = await manifestOf(page);
  await page.goto("/");
  await expect((await openJournal(page, testInfo)).composer).toHaveAccessibleName(
    `Record an Entry in ${home.name}`,
  );
  await screenKept(page);

  await page.context().setOffline(true);
  await page.goto(shortcuts[0].url);

  const composer = page
    .getByRole("region", { name: "Journal" })
    .getByRole("textbox", { name: `Record an Entry in ${home.name}` });
  await expect(composer).toBeFocused();
  await expect(page).toHaveURL("/");
  await page.context().setOffline(false);
});
