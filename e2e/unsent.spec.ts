import type { Page, Request, TestInfo } from "@playwright/test";
import {
  callContextTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  test,
} from "./fixtures.ts";

// With no network the Device takes two writes, recording an Entry and finishing a Task, which stay
// Unsent on it until Praxis receives them (section 8.8, ADR 0020). These are the offline journeys
// of ADR 0015 that need no Offline Copy. Each makes a Context of its own, so what it counts is its
// own.

/** A Context of this journey's own, shown on opening, holding these Tasks made by the person. */
async function contextWith(page: Page, testInfo: TestInfo, titles: string[]) {
  const { id } = await makeContext(page, {
    name: `Lift ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  if (titles.length === 0) return { id, tasks: [] };
  const { record } = await callContextTool(page, id, "record_entry", {
    words: "Errands",
    tasks: titles.map((title) => ({ title })),
  });
  return { id, tasks: record.tasks as { id: string; title: string }[] };
}

/** Where the count of what is open to act on is shown: a phone's tab, or the column's heading. */
function attentionCount(page: Page, testInfo: TestInfo) {
  return onPhone(testInfo)
    ? page.getByRole("navigation", { name: "Columns" }).getByRole("button", { name: /^Attention/ })
    : page.getByRole("region", { name: "Attention", exact: true }).locator(".peer-header");
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

/** What the screen sent to this tool, as the server received it. */
function sentTo(request: Request) {
  return request.postDataJSON() as Record<string, unknown>;
}

test("an Entry recorded with no network sits Unsent in the Journal, can be edited, and is sent once the network is back", async ({
  page,
}, testInfo) => {
  const { id } = await contextWith(page, testInfo, []);
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const unsentCount = page.getByRole("status").filter({ hasText: /^1 Unsent/ });
  // The composer names the Context once its settings are read.
  await expect(composer).toHaveAccessibleName(/^Record an Entry in Lift /);

  await page.context().setOffline(true);
  await expect(
    page.getByText(/^No network: recording an Entry and finishing a Task/),
  ).toBeVisible();
  await composer.fill("Thought of in the lift\n[] Ring the bank");
  await journal.getByRole("button", { name: "Record" }).click();

  const unsent = journal.getByTestId("unsent-entry");
  await expect(unsent).toHaveCount(1);
  await expect(unsent.getByText("Unsent", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(unsentCount).toBeVisible();
  // Its Inline Task is part of its words, and not yet a Task.
  await expect(unsent.getByText("[] Ring the bank")).toBeVisible();
  await expect(unsent.getByRole("checkbox")).toHaveCount(0);

  // The person's to change, with no trace.
  await unsent.getByRole("button", { name: "Edit" }).click();
  await unsent
    .getByRole("textbox", { name: "The Entry's words" })
    .fill("Thought of in the lift\n[] Ring the bank about the loan");
  await unsent.getByRole("button", { name: "Save" }).click();
  await expect(unsent.getByText("[] Ring the bank about the loan")).toBeVisible();

  const sent = page.waitForRequest(/\/tools\/record_entry$/);
  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await page.context().setOffline(false);
  const request = sentTo(await sent);
  expect((await (await answered).json()).ok).toBe(true);

  // It went with the time it was made, a key, and its words as edited.
  expect(request).toMatchObject({
    words: "Thought of in the lift\n[] Ring the bank about the loan",
    tasks: [{ title: "Ring the bank about the loan" }],
    made_at: expect.any(String),
    key: expect.any(String),
  });
  await expect(unsent).toHaveCount(0);
  await expect(unsentCount).toHaveCount(0);
  const recorded = journal.getByTestId("entry");
  await expect(recorded).toHaveCount(1);
  await expect(
    recorded.getByRole("checkbox", { name: "Ring the bank about the loan", exact: true }),
  ).toBeVisible();
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toHaveLength(1);
});

test("a Task finished with no network leaves Attention marked Unsent, can be undone, and is sent", async ({
  page,
}, testInfo) => {
  const [rent, gas] = ["Pay the rent", "Read the gas meter"];
  const { id, tasks } = await contextWith(page, testInfo, [rent, gas]);
  for (const task of tasks) {
    await callContextTool(page, id, "set_task_dates", { id: task.id, due_date: "2020-01-06" });
  }
  await page.goto("/");
  const attention = await openAttention(page, testInfo);
  const due = attention.getByRole("region", { name: "Due", exact: true });
  await expect(due.getByRole("listitem")).toHaveCount(2);
  await expect(attentionCount(page, testInfo)).toContainText("2 to act on");

  await page.context().setOffline(true);
  // Clicked, not checked: each leaves Attention at the tap, so its box is gone before it is read.
  await due.getByRole("checkbox", { name: rent, exact: true }).click();
  await due.getByRole("checkbox", { name: gas, exact: true }).click();

  // Both leave Attention at once, and are counted as Unsent.
  await expect(due.getByRole("listitem")).toHaveCount(0);
  await expect(attentionCount(page, testInfo)).not.toContainText("to act on");
  await expect(page.getByRole("status").filter({ hasText: /^2 Unsent/ })).toBeVisible();
  const { journal } = await openJournal(page, testInfo);
  const finishedUnsent = journal.getByText("Finished, Unsent", { exact: true });
  await expect(finishedUnsent).toHaveCount(2);

  // Undone on the Device, the finish leaves no trace: the Task is back in Attention.
  await journal.getByRole("checkbox", { name: gas, exact: true }).uncheck();
  await expect(finishedUnsent).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: /^1 Unsent/ })).toBeVisible();

  const sent: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (/\/tools\/finish_task$/.test(request.url())) sent.push(sentTo(request));
  });
  const answered = page.waitForResponse(/\/tools\/finish_task$/);
  await page.context().setOffline(false);
  expect((await (await answered).json()).ok).toBe(true);

  await expect(finishedUnsent).toHaveCount(0);
  await expect(journal.getByRole("checkbox", { name: rent, exact: true })).toBeChecked();
  await expect(journal.getByRole("checkbox", { name: gas, exact: true })).not.toBeChecked();
  expect(sent).toEqual([
    { id: tasks[0]?.id, key: expect.any(String), made_at: expect.any(String) },
  ]);
  const after = await openAttention(page, testInfo);
  await expect(
    after.getByRole("region", { name: "Due", exact: true }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(attentionCount(page, testInfo)).toContainText("1 to act on");
});

test("a finish the server refuses is shown as not accepted, is never sent again by itself, and stays until dismissed", async ({
  page,
}, testInfo) => {
  const title = "Return the drill";
  const { id, tasks } = await contextWith(page, testInfo, [title]);
  const [task] = tasks;
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const box = journal.getByRole("checkbox", { name: title, exact: true });
  await expect(box).toBeVisible();

  await page.context().setOffline(true);
  await box.check();
  await expect(journal.getByText("Finished, Unsent")).toBeVisible();
  // Meanwhile, elsewhere, the Task is dropped.
  await callContextTool(page, id, "drop_task", { id: task?.id });

  const answered = page.waitForResponse(/\/tools\/finish_task$/);
  await page.context().setOffline(false);
  expect(await (await answered).json()).toMatchObject({ ok: false, error: { code: "refused" } });

  const attention = await openAttention(page, testInfo);
  const notAccepted = attention.getByRole("region", { name: "Not accepted", exact: true });
  await expect(notAccepted.getByText(`Finishing “${title}” was not accepted`)).toBeVisible();
  await expect(notAccepted.getByText("The Task is Dropped: reopen it first.")).toBeVisible();
  await expect(attentionCount(page, testInfo)).toContainText("1 to act on");

  // Opened afresh, Praxis keeps it, and sends nothing again by itself.
  const sentAgain: string[] = [];
  page.on("request", (request) => {
    if (/\/tools\/finish_task$/.test(request.url())) sentAgain.push(request.url());
  });
  await page.reload();
  const reopened = await openAttention(page, testInfo);
  const stillThere = reopened.getByRole("region", { name: "Not accepted", exact: true });
  await expect(stillThere.getByText(`Finishing “${title}” was not accepted`)).toBeVisible();
  // A refused finish can only be dismissed.
  await expect(stillThere.getByRole("button")).toHaveText(["Dismiss"]);
  await stillThere.getByRole("button", { name: "Dismiss" }).click();
  await expect(stillThere).toHaveCount(0);
  await expect(attentionCount(page, testInfo)).not.toContainText("to act on");
  expect(sentAgain).toEqual([]);
});

test("a write whose answer was lost is kept Unsent, sent again, and made once", async ({
  page,
}, testInfo) => {
  const { id } = await contextWith(page, testInfo, []);
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toHaveAccessibleName(/^Record an Entry in Lift /);

  // The server makes the Entry, and its answer never reaches the Device.
  const keys: unknown[] = [];
  await page.route(/\/tools\/record_entry$/, async (route) => {
    keys.push(sentTo(route.request()).key);
    await route.fetch();
    await route.abort("internetdisconnected");
  });
  await composer.fill("Asked about the boiler");
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);

  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await page.unroute(/\/tools\/record_entry$/);
  const answer = await answered;
  expect((await answer.json()).ok).toBe(true);

  await expect(journal.getByTestId("unsent-entry")).toHaveCount(0);
  await expect(journal.getByTestId("entry")).toHaveCount(1);
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toHaveLength(1);
  // Each time it went, it went with the key it was made with.
  expect(new Set([...keys, sentTo(answer.request()).key]).size).toBe(1);
});

test("an Unsent Entry older than 30 days is put to the person like a refused one, and sent again by them", async ({
  page,
}, testInfo) => {
  const { id } = await contextWith(page, testInfo, []);
  // The Device's clock, which only the screen reads: the server keeps its own.
  await page.clock.install();
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toHaveAccessibleName(/^Record an Entry in Lift /);

  await page.context().setOffline(true);
  await composer.fill("Left in a drawer");
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);

  // Opened again 31 days on, it is not sent by itself: its key may be forgotten by now.
  const sent: string[] = [];
  page.on("request", (request) => {
    if (/\/tools\/record_entry$/.test(request.url())) sent.push(request.url());
  });
  await page.clock.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
  await page.context().setOffline(false);
  const attention = await openAttention(page, testInfo);
  const notAccepted = attention.getByRole("region", { name: "Not accepted", exact: true });
  await expect(notAccepted.getByText("An Entry was not accepted")).toBeVisible();
  await expect(notAccepted.getByText(/more than 30 days ago/)).toBeVisible();
  await expect(attentionCount(page, testInfo)).toContainText("1 to act on");
  expect(sent).toEqual([]);

  // The person sends it again, as edited, at the time it was made.
  await notAccepted
    .getByRole("textbox", { name: "The Entry's words" })
    .fill("Left in a drawer, found again");
  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await notAccepted.getByRole("button", { name: "Send again" }).click();
  expect((await (await answered).json()).ok).toBe(true);

  await expect(notAccepted).toHaveCount(0);
  await expect(attentionCount(page, testInfo)).not.toContainText("to act on");
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toEqual([expect.objectContaining({ words: "Left in a drawer, found again" })]);
});

test("a write made while another is still Unsent goes after it, in the order made", async ({
  page,
}, testInfo) => {
  const { id } = await contextWith(page, testInfo, []);
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toHaveAccessibleName(/^Record an Entry in Lift /);

  // The first write meets a network failure; every later call goes through.
  const reached: Record<string, unknown>[] = [];
  let failed = false;
  await page.route(/\/tools\/record_entry$/, async (route) => {
    if (!failed) {
      failed = true;
      return route.abort("internetdisconnected");
    }
    reached.push(sentTo(route.request()));
    await route.continue();
  });
  await composer.fill("First, in the tunnel");
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);

  // Made with the network back, the second is not sent ahead of the first.
  const second = page.waitForResponse(
    (response) =>
      /\/tools\/record_entry$/.test(response.url()) &&
      sentTo(response.request()).words === "Second, out of it",
  );
  await composer.fill("Second, out of it");
  await journal.getByRole("button", { name: "Record" }).click();
  expect((await (await second).json()).ok).toBe(true);

  expect(reached).toEqual([
    expect.objectContaining({ words: "First, in the tunnel", made_at: expect.any(String) }),
    expect.objectContaining({ words: "Second, out of it", made_at: expect.any(String) }),
  ]);
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(0);
  await expect(journal.getByTestId("entry").getByTestId("words")).toHaveText([
    "First, in the tunnel",
    "Second, out of it",
  ]);
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toHaveLength(2);
});

test("an Unsent Entry edited after its answer was lost is put to the person, not dropped", async ({
  page,
}, testInfo) => {
  const { id } = await contextWith(page, testInfo, []);
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toHaveAccessibleName(/^Record an Entry in Lift /);

  // The server makes the Entry, and its answer never reaches the Device.
  await page.route(/\/tools\/record_entry$/, async (route) => {
    await route.fetch();
    await route.abort("internetdisconnected");
  });
  await composer.fill("Met the plumber");
  await journal.getByRole("button", { name: "Record" }).click();
  const unsent = journal.getByTestId("unsent-entry");
  await expect(unsent).toHaveCount(1);
  await unsent.getByRole("button", { name: "Edit" }).click();
  await unsent.getByRole("textbox", { name: "The Entry's words" }).fill("Met the plumber at nine");
  await unsent.getByRole("button", { name: "Save" }).click();

  // Sent again with its key, it gives back the Entry as first made.
  const answered = page.waitForResponse(/\/tools\/record_entry$/);
  await page.unroute(/\/tools\/record_entry$/);
  expect((await (await answered).json()).value.record.words).toBe("Met the plumber");

  await expect(journal.getByTestId("entry").getByTestId("words")).toHaveText(["Met the plumber"]);
  const attention = await openAttention(page, testInfo);
  const notAccepted = attention.getByRole("region", { name: "Not accepted", exact: true });
  await expect(notAccepted.getByText(/already reached Praxis before your edit/)).toBeVisible();
  await expect(notAccepted.getByRole("textbox", { name: "The Entry's words" })).toHaveValue(
    "Met the plumber at nine",
  );
  const { items } = await callContextTool(page, id, "list_entries", {});
  expect(items).toEqual([expect.objectContaining({ words: "Met the plumber" })]);
});
