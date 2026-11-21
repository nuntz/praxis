import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  expect,
  lastShown,
  makeContext,
  openJournal,
  screenKept,
  test,
} from "./fixtures.ts";

// Praxis opens with no network (section 8.8): the service worker keeps the built screen, and the
// browser the Contexts it last read, so a Device that showed a Context before opens on it and takes
// an Entry Unsent. Each journey makes a Context of its own, so what it counts is its own.

/** The first shape of Unsent writes a release stored, as stored. */
const FIRST_UNSENT = join(import.meta.dirname, "../apps/pwa/test/stored/praxis.unsent-0001.txt");

/** A Context of this journey's own, shown on opening, in a zone that is not the Device's. */
async function contextOfOwn(page: Page, testInfo: TestInfo) {
  const made = await makeContext(page, {
    name: `Tunnel ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, made.id);
  return made;
}

/** A time as the Journal shows it, in this zone, or in the Device's own with none. */
function shownAt(page: Page, at: string, timeZone?: string) {
  return page.evaluate(
    ([instant, zone]) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        ...(zone ? { timeZone: zone } : {}),
      }).format(new Date(instant as string)),
    [at, timeZone] as const,
  );
}

test("Praxis opens with no network on the Context the Device last showed, takes an Entry Unsent, and sends it once the network is back", async ({
  page,
}, testInfo) => {
  const { id, name } = await contextOfOwn(page, testInfo);
  await page.goto("/");
  const first = await openJournal(page, testInfo);
  await expect(first.composer).toHaveAccessibleName(`Record an Entry in ${name}`);
  await screenKept(page);
  // What is kept is the screen and its files at the Deployment's own address: no tool's answer,
  // and no image from another host.
  const keptFiles = await page.evaluate(async () => {
    const kept: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) kept.push(request.url);
    }
    return kept;
  });
  const origin = new URL(page.url()).origin;
  expect(keptFiles).toContain(`${origin}/`);
  for (const file of keptFiles) {
    expect(new URL(file).origin).toBe(origin);
    expect(new URL(file).pathname).not.toMatch(/^\/(api|mcp|cdn-cgi)(\/|$)/);
  }

  await page.context().setOffline(true);
  await page.reload();

  // The screen opens on the Context last shown, named and in its accent, from the list last read.
  const switcher = page.getByRole("button", { name: `Context: ${name}`, exact: true });
  await expect(switcher).toBeVisible();
  await expect(switcher).toHaveClass(/\baccent-teal\b/);
  await expect(
    page.getByText(/^No network: recording an Entry and finishing a Task/),
  ).toBeVisible();
  const { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toHaveAccessibleName(`Record an Entry in ${name}`);
  // What the browser keeps of the Contexts is each one's listing, and nothing of the Journal.
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("praxis.contexts") ?? "null"),
  );
  expect(kept).toContainEqual({ id, name, accent: "teal", retired: false });
  for (const each of kept)
    expect(Object.keys(each).sort()).toEqual(["accent", "id", "name", "retired"]);

  await composer.fill("Written in the tunnel");
  await journal.getByRole("button", { name: "Record" }).click();
  const unsent = journal.getByTestId("unsent-entry");
  await expect(unsent).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: /^1 Unsent/ })).toBeVisible();
  // Its time is in the Device's zone, as the Context's settings are not read yet.
  const time = unsent.locator("time");
  const madeAt = await time.getAttribute("datetime");
  if (madeAt === null) throw new Error("The Unsent Entry shows no time it was made");
  await expect(time).toHaveText(await shownAt(page, madeAt));
  expect(await shownAt(page, madeAt)).not.toBe(await shownAt(page, madeAt, "UTC"));

  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await page.context().setOffline(false);
  expect((await (await answered).json()).ok).toBe(true);

  await expect(unsent).toHaveCount(0);
  const recorded = journal.getByTestId("entry");
  await expect(recorded.getByTestId("words")).toHaveText(["Written in the tunnel"]);
  // Once the settings are read, its time is in the Context's zone.
  await expect(recorded.locator("time")).toHaveText(await shownAt(page, madeAt, "UTC"));
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toEqual([expect.objectContaining({ words: "Written in the tunnel" })]);
});

test("a screen kept from an earlier release is shown only with no network, and the current one sends what was left Unsent under it", async ({
  page,
}, testInfo) => {
  const { id, name } = await contextOfOwn(page, testInfo);
  await page.goto("/");
  await expect(page.getByRole("button", { name: `Context: ${name}`, exact: true })).toBeVisible();
  await screenKept(page);
  // What an earlier release kept, as the service worker kept it, and replaced by none since.
  await page.evaluate(async () => {
    const name = (await caches.keys()).find((each) => each.startsWith("praxis-screen-"));
    if (!name) throw new Error("No screen is kept");
    const earlier =
      "<!doctype html><html lang='en'><title>Praxis</title><h1>An earlier release</h1>";
    await (await caches.open(name)).put(
      "/",
      new Response(earlier, { headers: { "content-type": "text/html" } }),
    );
  });

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "An earlier release" })).toBeVisible();
  // An Entry it left Unsent, in the first shape a release stored (apps/pwa/test/stored/), for
  // this journey's Context, with a key of its own made now: a later release reads it as written.
  const [released] = JSON.parse(readFileSync(FIRST_UNSENT, "utf8"));
  const write = {
    ...released,
    context: id,
    key: crypto.randomUUID(),
    keyed_at: new Date().toISOString(),
  };
  const { words, made_at: madeAt } = write;
  expect(words).toMatch(/\n\[\] Post the form$/);
  await page.evaluate(
    (stored) => localStorage.setItem("praxis.unsent", JSON.stringify([stored])),
    write,
  );

  // With the network the current screen is the one opened, and it sends what was left.
  await page.context().setOffline(false);
  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await page.reload();
  const sent = await answered;
  expect((await sent.json()).ok).toBe(true);
  expect(sent.request().postDataJSON()).toMatchObject({ words, made_at: madeAt });
  await expect(page.getByRole("heading", { name: "An earlier release" })).toHaveCount(0);
  const { journal } = await openJournal(page, testInfo);
  const recorded = journal.getByTestId("entry");
  await expect(recorded).toHaveCount(1);
  await expect(
    recorded.getByRole("checkbox", { name: "Post the form", exact: true }),
  ).toBeVisible();
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toEqual([expect.objectContaining({ words, at: madeAt })]);
});
