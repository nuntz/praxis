import { readFile } from "node:fs/promises";
import { expect, lastShown, makeContext, onPhone, openJournal, test } from "./fixtures.ts";

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
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
  }
  const conversation = page.getByRole("region", { name: "Conversation" });

  const words = `Pick up the dry cleaning ${tag}`;
  await conversation
    .getByRole("textbox", { name: `Message the Agent in Agent ${tag}`, exact: true })
    .fill(`Record: ${words}`);
  await conversation.getByRole("button", { name: "Send", exact: true }).click();

  const messages = conversation.getByRole("list", { name: "Messages" }).getByTestId("message");
  await expect(messages).toHaveCount(2);
  const call = messages.last().getByText("1 call", { exact: true });
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
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
  }
  const conversation = page.getByRole("region", { name: "Conversation" });

  const asked = `Say: **The boathouse** is cheaper ${tag}\n- under the ceiling\n- see https://forms.example.com/offsite`;
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
  if (onPhone(testInfo)) {
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
  }
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
    if (!onPhone(testInfo)) return;
    await page
      .getByRole("navigation", { name: "Columns" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
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
  await messages.last().getByText("1 call", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await messages.last().getByRole("button", { name: "Save this Run's transcript" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^praxis-run-.+\.json$/);
  const saved = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(saved).toMatchObject({ kind: "run_transcript", context: { id: context.id } });
  expect(JSON.stringify(saved.messages)).toContain(words);

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: `Settings for Cleared ${tag}` });
  await settings.getByRole("button", { name: "Clear the Conversation", exact: true }).click();
  const clearing = page.waitForResponse(/\/tools\/clear_conversation$/);
  await settings.getByRole("button", { name: "Clear it for good", exact: true }).click();
  expect((await (await clearing).json()).ok).toBe(true);
  await expect(settings.getByText(/^The Conversation is cleared/)).toBeVisible();

  // Every screen open on the Conversation hears it was cleared: it holds no Message.
  await toConversation();
  await expect(messages).toHaveCount(0);
});
