import { readFile } from "node:fs/promises";
import type { WebSocketRoute } from "@playwright/test";
import type { MessagesPage } from "@praxis/domain";
import {
  callContextTool,
  closeSettings,
  expect,
  holdAgentMessages,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  openSettings,
  showTab,
  test,
} from "./fixtures.ts";

test("asking the Agent for a change, the Journal shows it as it is made", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Agent ${tag}`,
    time_zone: "UTC",
    accent: "plum",
  });
  await lastShown(page, context.id);
  await page.goto("/");
  // On a desktop the Journal is open beside the Conversation, and patches as the Agent works.
  const { journal } = onPhone(testInfo) ? { journal: null } : await openJournal(page, testInfo);
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });

  const words = `Pick up the dry cleaning ${tag}`;
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Agent ${tag}`, exact: true })
    .fill(`Record: ${words}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages).toHaveCount(2);
  const call = messages.last().getByText("1 tool used", { exact: true });
  await expect(call).toBeVisible();
  if (journal) await expect(journal.getByTestId("entry").filter({ hasText: words })).toBeVisible();

  // The change folds under the Agent's Message, and leads to its record.
  await call.click();
  await messages.last().getByRole("link", { name: words, exact: true }).click();
  const shown = page
    .getByRole("region", { name: "Journal" })
    .getByTestId("entry")
    .filter({ hasText: words });
  await expect(shown).toBeVisible();
  await expect(shown).toBeFocused();
});

test("a Message from the Agent is rendered as Markdown, and the person's own is shown as typed", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Markdown ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, context.id);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  // An image's host, which counts what the browser asks it for.
  const images: string[] = [];
  await page.route("https://images.example/**", (route) => {
    images.push(route.request().url());
    return route.abort();
  });

  const asked = `Say: **The boathouse** is cheaper ${tag}\n- under the ceiling\n- see https://forms.example.com/offsite\n\n![Floor plan ${tag}](https://images.example/floor-plan.png)`;
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Markdown ${tag}`, exact: true })
    .fill(asked);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  const answer = messages.last().getByTestId("words");
  await expect(answer.locator("strong")).toHaveText("The boathouse");
  await expect(answer.getByRole("listitem")).toHaveText([
    "under the ceiling",
    "see https://forms.example.com/offsite",
  ]);
  await expect(
    answer.getByRole("link", { name: "https://forms.example.com/offsite", exact: true }),
  ).toHaveAttribute("rel", "noreferrer");
  // An image in a Message never loads: it is its description, with nothing to tap.
  await expect(answer.getByText(`Floor plan ${tag}`, { exact: true })).toBeVisible();
  await expect(answer.getByRole("img")).toHaveCount(0);
  await expect(answer.getByRole("button")).toHaveCount(0);
  expect(images).toEqual([]);
  await expect(conversation.getByText(asked, { exact: true })).toBeVisible();
});

test("a Run that failed keeps the Message with a Notice under it, and Try again answers it", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Unreached ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, context.id);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });

  const words = `Unreachable once: are you there ${tag}`;
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Unreached ${tag}`, exact: true })
    .fill(words);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  const sent = messages.filter({ hasText: words });
  await expect(sent.getByText(/The model could not be reached/)).toBeVisible();
  await expect(messages).toHaveCount(1);
  // The failed Run can be saved for debugging from its Notice, as any Run from its calls.
  await expect(sent.getByRole("button", { name: "Save this Run's transcript" })).toBeVisible();

  const retried = page.waitForResponse(/\/retry_run$/);
  await sent.getByRole("button", { name: "Try again", exact: true }).click();
  expect(await (await retried).json()).toMatchObject({ ok: true });

  await expect(messages.last().getByText("Back again.", { exact: true })).toBeVisible();
  await expect(messages).toHaveCount(2);
  await expect(sent.getByText(/The model could not be reached/)).toHaveCount(0);
});

test("a Run whose request the provider refused says so under the Message, not that the model was unreachable, and Try again answers it", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Refused ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, context.id);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });

  const words = `Refused once: are you there ${tag}`;
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Refused ${tag}`, exact: true })
    .fill(words);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  const sent = messages.filter({ hasText: words });
  await expect(sent.getByRole("status")).toHaveText(
    "The model's provider refused Praxis's request, so the Agent did not answer. Your Message is kept.",
  );
  await expect(sent.getByText(/could not be reached|tried again/)).toHaveCount(0);

  const retried = page.waitForResponse(/\/retry_run$/);
  await sent.getByRole("button", { name: "Try again", exact: true }).click();
  expect(await (await retried).json()).toMatchObject({ ok: true });

  await expect(messages.last().getByText("Back again.", { exact: true })).toBeVisible();
  await expect(sent.getByText(/refused Praxis's request/)).toHaveCount(0);
});

test("the person saves a Run's transcript, then clears the Conversation from the settings", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Cleared ${tag}`,
    time_zone: "UTC",
    accent: "moss",
  });
  await lastShown(page, context.id);
  await page.goto("/");
  const toConversation = async () => {
    await showTab(page, testInfo, "Agent");
  };
  await toConversation();
  const conversation = page.getByRole("region", { name: "Conversation" });
  const words = `Water the ferns ${tag}`;
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Cleared ${tag}`, exact: true })
    .fill(`Record: ${words}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages).toHaveCount(2);

  // One Run, saved as a file by the person's tap: what the Agent was given, said and called.
  await messages.last().getByText("1 tool used", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await messages.last().getByRole("button", { name: "Save this Run's transcript" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^praxis-run-.+\.json$/);
  const saved = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(saved).toMatchObject({ kind: "run_transcript", context: { id: context.id } });
  expect(JSON.stringify(saved.messages)).toContain(words);

  const { items } = await callContextTool(page, context.id, "list_messages", {});
  const sent = items.find((message: { from: string }) => message.from === "person");
  // Clear only marks it, beside a Keep it that takes the focus and gives it back to Clear; it is
  // cleared as the section is left.
  const settings = await openSettings(page, "Conversation and search");
  await expect(settings).toContainText(`Cleared ${tag}`);
  const clear = settings.getByRole("button", { name: "Clear the Conversation", exact: true });
  const keep = settings.getByRole("button", { name: "Keep it", exact: true });
  await clear.click();
  await expect(
    settings.getByText("Cleared when you leave Conversation and search.", { exact: true }),
  ).toBeVisible();
  await expect(keep).toBeFocused();
  await keep.click();
  await expect(clear).toBeFocused();
  await clear.click();
  const clearing = page.waitForRequest(/\/tools\/clear_conversation$/);
  const cleared = page.waitForResponse(/\/tools\/clear_conversation$/);

  // Every screen open on the Conversation hears it was cleared: it holds no Message.
  await closeSettings(page);
  // Up to the newest Message the screen had read, the person's, as it was sent.
  expect((await clearing).postDataJSON()).toMatchObject({ up_to: sent.at });
  expect((await (await cleared).json()).ok).toBe(true);
  await toConversation();
  await expect(messages).toHaveCount(0);
  await expect(
    conversation.getByText(`Nothing said to the Agent in Cleared ${tag} yet.`, { exact: true }),
  ).toBeVisible();
});

test("a Clear sent as the section is left, once a Message came after the newest the screen had read, clears nothing and says so", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Kept ${tag}`,
    time_zone: "UTC",
    accent: "moss",
  });
  await callContextTool(page, context.id, "send_message", { words: `Say: Read ${tag}` });
  await lastShown(page, context.id);
  await page.goto("/");
  const settings = await openSettings(page, "Conversation and search");
  const clear = settings.getByRole("button", { name: "Clear the Conversation", exact: true });
  await expect(clear).toBeEnabled();
  await clear.click();

  // A Message from another Device, after the tap, answered before the section is left.
  await callContextTool(page, context.id, "send_message", { words: `Say: Since ${tag}` });
  await expect
    .poll(async () => {
      const { items } = await callContextTool(page, context.id, "list_runs", {});
      return items.filter((run: { ended: string | null }) => run.ended !== null).length;
    })
    .toBe(2);
  const cleared = page.waitForResponse(/\/tools\/clear_conversation$/);
  await closeSettings(page);

  expect(await (await cleared).json()).toMatchObject({ ok: false, error: { code: "refused" } });
  await expect(page.getByRole("alert")).toHaveText(
    "A Message came after the newest one you had seen, so nothing was cleared: look at it, then clear again.",
  );
  const { items } = await callContextTool(page, context.id, "list_messages", {});
  expect(items).toHaveLength(4);
});

test("a Conversation that cannot be opened can still be cleared, which mends it", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Mended ${tag}`,
    time_zone: "UTC",
    accent: "plum",
  });
  await lastShown(page, context.id);
  // The journeys' Worker opens every Conversation, so the screen is told this one cannot be:
  // `upgrade.test.ts` clears one that cannot, for real.
  await page.route(/\/tools\/list_messages$/, async (route) => {
    const answer = await route.fetch();
    const { value } = (await answer.json()) as { value: MessagesPage };
    await route.fulfill({
      response: answer,
      json: { ok: true, value: { ...value, items: [], next_cursor: null, agent: "unavailable" } },
    });
  });
  await page.goto("/");
  const settings = await openSettings(page, "Conversation and search");
  const clear = settings.getByRole("button", { name: "Clear the Conversation", exact: true });
  await expect(clear).toBeEnabled();
  await clear.click();
  const clearing = page.waitForRequest(/\/tools\/clear_conversation$/);
  const cleared = page.waitForResponse(/\/tools\/clear_conversation$/);
  await closeSettings(page);

  // It shows no Message, so the screen read none: up to before any, with no clock of its own.
  expect((await clearing).postDataJSON()).toMatchObject({ up_to: "1970-01-01T00:00:00.000Z" });
  expect((await (await cleared).json()).ok).toBe(true);
});

test("between a Message sent and its answer, the Agent is said to be at work where the answer will appear", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Working ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "moss" });
  await lastShown(page, context.id);
  const agent = await holdAgentMessages(page);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: Booked ${tag}.`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const list = conversation.getByRole("list", { name: "Messages" });
  await expect(list.getByTestId("message")).toHaveCount(1);
  await expect.poll(agent.held).toBe(1);
  await expect(list.getByText("Agent working", { exact: true })).toBeVisible();
});

test("an answer to the person's Message is read out once whole, as shown, with no Markdown", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Read out ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "moss" });
  await lastShown(page, context.id);
  const agent = await holdAgentMessages(page);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: The **boathouse** is booked ${tag}.`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const readOut = conversation.getByRole("status").filter({ hasText: /^The Agent answered: / });
  await expect.poll(agent.held).toBe(1);
  await expect(readOut).toHaveCount(0);
  agent.release();
  await expect(readOut).toHaveText(`The Agent answered: The boathouse is booked ${tag}.`);
  await expect(
    conversation.getByRole("list", { name: "Messages" }).getByText("Agent working"),
  ).toHaveCount(0);
});

test("an answer read out keeps its paragraphs and list items apart", async ({ page }, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Apart ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "moss" });
  await lastShown(page, context.id);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: Booked ${tag}.\n\n- milk\n- eggs`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const readOut = conversation.getByRole("status").filter({ hasText: /^The Agent answered: / });
  await expect(readOut).toHaveText(`The Agent answered: Booked ${tag}. milk eggs`);
});

test("an answer is read out once, and not again when the newest Messages are read afresh", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Once ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "moss" });
  await lastShown(page, context.id);
  // The live channel as it goes, so the journey can drop it.
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/live$/, (socket) => {
    socket.connectToServer();
    channel = socket;
  });
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: Booked ${tag}.`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  const readOut = conversation.getByRole("status").filter({ hasText: /^The Agent answered: / });
  await expect(readOut).toHaveText(`The Agent answered: Booked ${tag}.`);

  // From here, each time the answer is read out again is counted.
  await readOut.evaluate((element) => {
    const counted = window as unknown as { readOutAgain: number };
    counted.readOutAgain = 0;
    new MutationObserver(() => {
      if (element.textContent?.startsWith("The Agent answered: ")) counted.readOutAgain++;
    }).observe(element, { childList: true, characterData: true, subtree: true });
  });
  // The live channel drops and rejoins, and the newest page is read afresh.
  const readAfresh = page.waitForResponse(/\/tools\/list_messages$/);
  await channel?.close();
  await readAfresh;
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  expect(
    await page.evaluate(() => (window as unknown as { readOutAgain: number }).readOutAgain),
  ).toBe(0);
});

test("Return in the Conversation's composer sends where there is hover, and on a touch screen starts a new line", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Lines ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "slate" });
  await lastShown(page, context.id);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  const composer = conversation.getByRole("textbox", {
    name: `Message the Agent in ${name}`,
    exact: true,
  });
  await expect(composer).toHaveAttribute("enterkeyhint", onPhone(testInfo) ? "enter" : "send");
  await composer.fill(`Say: First line ${tag}`);
  // Return that picks what an input method is composing is the input method's, and sends nothing.
  const takenToSend = await composer.evaluate((element) => {
    const picking = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(picking);
    return picking.defaultPrevented;
  });
  expect(takenToSend).toBe(false);
  await composer.press("Enter");
  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  if (onPhone(testInfo)) {
    await composer.pressSequentially(`Second line ${tag}`);
    await expect(composer).toHaveValue(`Say: First line ${tag}\nSecond line ${tag}`);
    await expect(messages).toHaveCount(0);
    await conversation.getByRole("button", { name: "Send", exact: true }).click();
  }
  await expect(messages).toHaveCount(2);
  await expect(messages.first()).toContainText(`First line ${tag}`);
});

test("a Conversation shown when the network goes shows nothing of itself but that it needs one", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const name = `Cut off ${tag}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "blue" });
  await lastShown(page, context.id);
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });
  await conversation
    .getByRole("textbox", { name: `Message the Agent in ${name}`, exact: true })
    .fill(`Say: Kept here ${tag}.`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();
  const list = conversation.getByRole("list", { name: "Messages" });
  await expect(list.getByTestId("message")).toHaveCount(2);

  await page.context().setOffline(true);
  await expect(conversation.getByText(/^No network: the Conversation needs one\./)).toBeVisible();
  await expect(list).toBeHidden();
});
