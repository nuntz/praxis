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

  const retried = page.waitForResponse(/\/retry_run$/);
  await sent.getByRole("button", { name: "Try again", exact: true }).click();
  expect(await (await retried).json()).toMatchObject({ ok: true });

  await expect(messages.last().getByText("Back again.", { exact: true })).toBeVisible();
  await expect(messages).toHaveCount(2);
  await expect(sent.getByText(/The model could not be reached/)).toHaveCount(0);
});
