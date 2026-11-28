import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  expect,
  holdCall,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  showTab,
  test,
} from "./fixtures.ts";

// A Held Change (section 4.7): the Agent asked to change the person's words, and only the person's
// tap makes it. The journey makes a Context of its own, so the count it reads is its own.

/** Where the count of what is open to act on is shown: a phone's tab, or the column's heading. */
function count(page: Page, testInfo: TestInfo) {
  return onPhone(testInfo)
    ? page.getByRole("navigation", { name: "Columns" }).getByRole("button", { name: /^Attention/ })
    : page.getByRole("region", { name: "Attention", exact: true }).locator(".peer-header");
}

test("the Agent's change to the person's words waits for their tap, which makes it", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await makeContext(page, {
    name: `Held ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  const before = `Called the landlord abuot the boiler ${tag}`;
  const after = `Called the landlord about the boiler ${tag}`;
  const { record: entry } = await callContextTool(page, id, "record_entry", { words: before });

  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Held ${tag}`, exact: true })
    .fill(`Edit ${entry.id} at ${entry.version}: ${after}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  // It waits where the Agent left it, saying who asked, and comparing the words now with those
  // the tap brings, as typed: the one word that goes and the one that comes.
  const left = conversation.getByRole("region", { name: "Held Change: Edit your Entry's words" });
  await expect(left.getByText(/^Asked by the Agent, \S/)).toBeVisible();
  const comparison = left.getByTestId("comparison");
  await expect(comparison.locator("del")).toHaveText(["removed: abuot"]);
  await expect(comparison.locator("ins")).toHaveText(["added: about"]);
  await expect(count(page, testInfo)).toContainText("1 to act on");

  // Its Entry is unchanged, and marked with a way to it in Attention.
  const { journal } = await openJournal(page, testInfo);
  const shown = journal.getByTestId("entry").filter({ hasText: before });
  await expect(shown.getByTestId("words")).toHaveText(before);
  await shown.getByRole("link", { name: "Held Change for your tap", exact: true }).click();
  const held = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("region", { name: "Held Changes", exact: true })
    .getByRole("region", { name: "Held Change: Edit your Entry's words" });
  await expect(held).toBeFocused();
  await expect(held.getByTestId("comparison").locator("ins")).toHaveText(["added: about"]);

  // While the tap is out its button is said to be disabled and keeps the focus. The call itself
  // is held, before it reaches the server, whose change the live channel would bring meanwhile.
  const out = await holdCall(page, /\/tools\/make_held_change$/);
  let asked = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/tools/make_held_change")) asked++;
  });
  const make = held.getByRole("button", { name: "Make this change", exact: true });
  const made = page.waitForResponse(/\/tools\/make_held_change$/);
  await make.click();
  await expect(make).toHaveAttribute("aria-disabled", "true");
  await expect(make).toBeFocused();
  // A press meanwhile sends nothing more. Forced, as Playwright waits on a button said disabled.
  await make.click({ force: true });
  out.send();
  expect((await (await made).json()).ok).toBe(true);
  expect(asked).toBe(1);

  // The tap makes it: the Entry's words change, edited by the Agent, and a line in the Held
  // Change's place says so, with the focus.
  await expect(held).toHaveCount(0);
  const said = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("region", { name: "Held Changes", exact: true })
    .getByRole("status");
  await expect(said).toHaveText("Made by your tap");
  await expect(said).toBeFocused();
  await expect(count(page, testInfo)).not.toContainText("to act on");

  await openJournal(page, testInfo);
  const changed = journal.locator(`[id="entry-${entry.id}"]`);
  await expect(changed.getByTestId("words")).toHaveText(after);
  await expect(
    changed.getByRole("button", { name: "Edited by the Agent", exact: true }),
  ).toBeVisible();
  await expect(changed.getByRole("link", { name: "Held Change for your tap" })).toHaveCount(0);
  await showTab(page, testInfo, "Agent");
  await expect(left).toHaveCount(0);
});

test("a Held Change whose Entry changes while it is shown lapses, said in its place", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await makeContext(page, {
    name: `Lapsed ${tag}`,
    time_zone: "UTC",
    accent: "plum",
  });
  await lastShown(page, id);
  const before = `Met Bea at the libary ${tag}`;
  const { record: entry } = await callContextTool(page, id, "record_entry", { words: before });

  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Lapsed ${tag}`, exact: true })
    .fill(`Edit ${entry.id} at ${entry.version}: Met Bea at the library ${tag}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  const left = conversation.getByRole("region", { name: "Held Change: Edit your Entry's words" });
  await expect(left).toBeVisible();

  // The person is at it in Attention, led there from its Entry, when the Entry changes elsewhere.
  const { journal } = await openJournal(page, testInfo);
  await journal
    .locator(`[id="entry-${entry.id}"]`)
    .getByRole("link", { name: "Held Change for your tap", exact: true })
    .click();
  const heldChanges = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("region", { name: "Held Changes", exact: true });
  const held = heldChanges.getByRole("region", { name: "Held Change: Edit your Entry's words" });
  await expect(held).toBeFocused();
  await callContextTool(page, id, "edit_entry", {
    id: entry.id,
    version: entry.version,
    words: `Met Bea at the libary, then lunch ${tag}`,
  });

  // It lapses: a line says so where it was, and takes the focus it had.
  const said = heldChanges.getByRole("status");
  await expect(said).toHaveText("Lapsed: its Entry changed");
  await expect(said).toBeFocused();
  await expect(held).toHaveCount(0);
  await expect(count(page, testInfo)).not.toContainText("to act on");
  await showTab(page, testInfo, "Agent");
  await expect(left).toHaveCount(0);
});

test("a tap on a Held Change that lapsed before the screen heard says it no longer applies", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await makeContext(page, {
    name: `Unheard ${tag}`,
    time_zone: "UTC",
    accent: "moss",
  });
  await lastShown(page, id);
  const before = `Booked the vet for Tusday ${tag}`;
  const { record: entry } = await callContextTool(page, id, "record_entry", { words: before });
  // The live channel passes on what the server says until the journey stops hearing it.
  let hearing = true;
  await page.routeWebSocket(/\/live$/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (hearing) socket.send(message);
    });
  });

  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Unheard ${tag}`, exact: true })
    .fill(`Edit ${entry.id} at ${entry.version}: Booked the vet for Tuesday ${tag}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  const left = conversation.getByRole("region", { name: "Held Change: Edit your Entry's words" });
  await expect(left).toBeVisible();

  // Its Entry changes elsewhere, and the screen does not hear: the Held Change is still shown.
  hearing = false;
  await callContextTool(page, id, "edit_entry", {
    id: entry.id,
    version: entry.version,
    words: `Booked the vet for Thursday ${tag}`,
  });
  const refused = page.waitForResponse(/\/tools\/make_held_change$/);
  await left.getByRole("button", { name: "Make this change", exact: true }).click();
  expect((await (await refused).json()).ok).toBe(false);

  // The refusal is said where it was tapped, with the focus, in place of the Held Change.
  const said = conversation.getByRole("status").filter({ hasText: "no longer applies" });
  await expect(said).toHaveText("That change no longer applies: its Entry changed");
  await expect(said).toBeFocused();
  await expect(left).toHaveCount(0);
});

test("a Held Change cancelled while the person moved on says so in its place, leaving the focus where they took it", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await makeContext(page, {
    name: `Cancelled ${tag}`,
    time_zone: "UTC",
    accent: "rust",
  });
  await lastShown(page, id);
  const { record: first } = await callContextTool(page, id, "record_entry", {
    words: `Paid the plumber 120 ${tag}`,
  });
  const { record: second } = await callContextTool(page, id, "record_entry", {
    words: `Paid the electrician 80 ${tag}`,
  });

  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  const composer = conversation.getByRole("textbox", {
    name: `Message the Agent in Cancelled ${tag}`,
    exact: true,
  });
  const cards = conversation.getByRole("region", { name: "Held Change: Edit your Entry's words" });
  const asks = [
    `Edit ${first.id} at ${first.version}: Paid the plumber 210 ${tag}`,
    `Edit ${second.id} at ${second.version}: Paid the electrician 90 ${tag}`,
  ];
  for (const [index, ask] of asks.entries()) {
    await composer.fill(ask);
    await conversation.getByRole("button", { name: "Send", exact: true }).click();
    await expect(cards).toHaveCount(index + 1);
  }
  const plumber = cards.filter({ hasText: "plumber" });

  // The person cancels one, and while the cancel is out takes the focus to the composer.
  const out = await holdCall(page, /\/tools\/cancel_held_change$/);
  const cancelled = page.waitForResponse(/\/tools\/cancel_held_change$/);
  await plumber.getByRole("button", { name: "Cancel", exact: true }).click();
  await out.asked();
  await composer.focus();
  out.send();
  expect((await (await cancelled).json()).ok).toBe(true);

  // A line says so in its place, and the focus stays where the person took it. The other waits.
  await expect(plumber).toHaveCount(0);
  await expect(conversation.getByRole("status").filter({ hasText: "Cancelled" })).toHaveText(
    "Cancelled",
  );
  await expect(composer).toBeFocused();
  const electrician = cards.filter({ hasText: "electrician" });
  await expect(electrician.getByTestId("comparison").locator("ins")).toHaveText(["added: 90"]);
});
