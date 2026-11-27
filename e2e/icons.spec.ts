import type { Page } from "@playwright/test";
import { callContextTool, expect, lastShown, makeContext, onPhone, test } from "./fixtures.ts";

// Icons across the screen (section 8.11): an icon sits beside its label on the tabs, Attention's
// sections and the primary buttons, and stands alone only on a well-known action, Dates and Send
// among them, which then has an accessible name and a tooltip. Each journey makes a Context of its
// own, so what it counts is its own.

/** `warn`, which only Overdue takes in Attention. */
const WARN = "rgb(180, 35, 24)";
/** `muted`, the colour of every other reason under a Task's title. */
const MUTED = "rgb(89, 96, 112)";

/** Today in UTC, the time zone of the Contexts these journeys make. */
const today = () => new Date().toISOString().slice(0, 10);

const tabs = (page: Page) => page.getByRole("navigation", { name: "Columns" });

test("on a phone each tab shows its icon beside its name, and the Attention tab's count is read out by name", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone has the tabs.");
  const { id } = await makeContext(page, {
    name: `Tabbed ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "rust",
  });
  await lastShown(page, id);
  const { record } = await callContextTool(page, id, "record_entry", {
    words: "Post",
    tasks: [{ title: "Post the parcel" }],
  });
  await callContextTool(page, id, "set_task_dates", {
    id: record.tasks[0].id,
    due_date: "2020-01-06",
  });

  await page.goto("/");
  const buttons = tabs(page).getByRole("button");
  await expect(buttons.nth(0)).toHaveAccessibleName("Attention 1 to act on");
  await expect(buttons.nth(1)).toHaveAccessibleName("Journal");
  await expect(buttons.nth(2)).toHaveAccessibleName("Agent");
  for (const tab of await buttons.all()) await expect(tab.locator("svg")).toBeVisible();
});

test("on a phone the Agent tab carries a mark, read out by name, while a Brief is unread", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone has the tabs.");
  // The Brief comes at the next minute on the clock, which can be most of two away.
  test.setTimeout(150_000);
  // A Context named so, the journeys' scripted model leaves a Brief with something to raise.
  const { id } = await makeContext(page, {
    name: `Briefed ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  // At least a minute off, so the Brief cannot come between its time and the setting of it.
  const time = new Date(Date.now() + 70_000).toISOString().slice(11, 16);
  await callContextTool(page, id, "set_brief_time", { time });

  await page.goto("/");
  const agent = tabs(page).getByRole("button", { name: /^Agent/ });
  await expect(agent).toHaveAccessibleName("Agent");
  // The Conversation is behind its tab, so the Brief stays unread while Attention is shown.
  await expect(agent).toHaveAccessibleName("Agent Brief unread", { timeout: 120_000 });
  await expect(agent.locator("svg")).toBeVisible();

  // Read once its Conversation shows it, and the mark goes.
  await agent.click();
  await expect(
    page.getByRole("region", { name: "Conversation" }).getByText("Brief", { exact: true }),
  ).toBeVisible();
  await expect(agent).toHaveAccessibleName("Agent");
});

test("Attention's sections carry their icons, a Task's page has an icon on each line, and only Overdue is in warn", async ({
  page,
}) => {
  const { id } = await makeContext(page, {
    name: `Iconed ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "moss",
  });
  await lastShown(page, id);
  const [dueToday, overdue, loose, inProject] = [
    "Pay the plumber",
    "Post the parcel",
    "Water the plants",
    "Buy the paint",
  ];
  const { record } = await callContextTool(page, id, "record_entry", {
    words: "Errands",
    tasks: [dueToday, overdue, loose, inProject].map((title) => ({ title })),
  });
  const [today_, late, , painted] = record.tasks as { id: string }[];
  await callContextTool(page, id, "set_task_dates", { id: today_?.id, due_date: today() });
  await callContextTool(page, id, "set_task_dates", { id: late?.id, due_date: "2020-01-06" });
  const { record: painting } = await callContextTool(page, id, "create_project", {
    name: "Painting",
  });
  await callContextTool(page, id, "move_task", { id: painted?.id, project_id: painting.id });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  for (const name of [/^Due \d+$/, /^Projects$/, /^Loose$/]) {
    const heading = attention.getByRole("heading", { name });
    await expect(heading).toBeVisible();
    await expect(heading.locator("svg")).toBeVisible();
  }
  // Loose's is a list, not the circle a Task's round control is drawn as.
  await expect(attention.getByRole("heading", { name: "Loose" }).locator("svg")).toHaveClass(
    /\blucide-list\b/,
  );

  // Due today is bold in the muted colour, and only Overdue is in warn, each at the end of its row.
  const due = attention.getByRole("region", { name: /^Due( \d+)?$/ });
  const todays = due.getByRole("button", { name: dueToday, exact: true }).getByText("Due today");
  await expect(todays).toBeVisible();
  await expect(todays).toHaveCSS("color", MUTED);
  await expect(todays).toHaveCSS("font-weight", "700");
  const lates = due.getByRole("button", { name: overdue, exact: true }).getByText(/2020, Overdue$/);
  await expect(lates).toHaveCSS("color", WARN);

  // A row carries no word for its actions: each opens its Task's page, where each line has its icon
  // beside its name.
  await expect(attention.getByText("Dates", { exact: true })).toHaveCount(0);
  await attention.getByRole("button", { name: loose, exact: true }).click();
  const opened = attention.getByRole("dialog", { name: loose });
  for (const line of ["Due Date", "Defer Date"]) {
    await expect(opened.getByLabel(line, { exact: true })).toBeVisible();
  }
  for (const line of [
    /^Recurrence/,
    /^Delegated to/,
    /^Waits on/,
    /^Project/,
    /^Drop/,
    /^Delete/,
  ]) {
    await expect(opened.getByRole("button", { name: line }).locator("svg").first()).toBeVisible();
  }
});

test("Send is a round button with its icon, Record a pill with its icon and its word, and both composers show their label", async ({
  page,
}, testInfo) => {
  const name = `Sends ${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await makeContext(page, { name, time_zone: "UTC", accent: "plum" });
  await lastShown(page, id);
  await page.goto("/");

  if (onPhone(testInfo)) await tabs(page).getByRole("button", { name: "Journal" }).click();
  const journal = page.getByRole("region", { name: "Journal" });
  await expect(journal.getByText(`Record an Entry in ${name}`, { exact: true })).toBeVisible();
  const record = journal.getByRole("button", { name: "Record", exact: true });
  await expect(record).toHaveText("Record");
  await expect(record.locator("svg")).toBeVisible();

  if (onPhone(testInfo)) await tabs(page).getByRole("button", { name: "Agent" }).click();
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(
    conversation.getByText(`Message the Agent in ${name}`, { exact: true }),
  ).toBeVisible();
  const send = conversation.getByRole("button", { name: "Send", exact: true });
  await expect(send).toHaveText("");
  await expect(send).toHaveAttribute("title", "Send");
  await expect(send.locator("svg")).toBeVisible();
  const box = await send.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(40);
  expect(box?.width).toBe(box?.height);
});
