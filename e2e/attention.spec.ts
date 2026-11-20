import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  test,
} from "./fixtures.ts";

// Attention is what in the current Context is open for the person to act on, derived by rule
// (section 8.3). Each journey makes a Context of its own, so what it counts is its own.

/** A Context of this journey's own, shown on opening, holding these Tasks made by the person. */
async function contextWith(page: Page, testInfo: TestInfo, titles: string[]) {
  const { id } = await makeContext(page, {
    name: `Errands ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "moss",
  });
  await lastShown(page, id);
  const { record } = await callContextTool(page, id, "record_entry", {
    words: "Errands",
    tasks: titles.map((title) => ({ title })),
  });
  return { id, tasks: record.tasks as { id: string; title: string }[] };
}

/** Where the count of what is open to act on is shown: a phone's tab, or the column's heading. */
function count(page: Page, testInfo: TestInfo) {
  return onPhone(testInfo)
    ? page.getByRole("navigation", { name: "Columns" }).getByRole("button", { name: /^Attention/ })
    : page.getByRole("region", { name: "Attention", exact: true }).locator(".peer-header");
}

test("the person finishes a Task from Attention, and it leaves Due and the count", async ({
  page,
}, testInfo) => {
  const [overdue, dueToo] = ["Post the parcel", "Pay the plumber"];
  const { id, tasks } = await contextWith(page, testInfo, [overdue, dueToo]);
  for (const task of tasks) {
    await callContextTool(page, id, "set_task_dates", { id: task.id, due_date: "2020-01-06" });
  }

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const due = attention.getByRole("region", { name: "Due", exact: true });
  await expect(due.getByRole("listitem")).toHaveCount(2);
  const task = due.getByRole("listitem").filter({ hasText: overdue });
  await expect(task.getByText(/^Due .+2020, Overdue$/)).toBeVisible();
  await expect(count(page, testInfo)).toContainText("2 to act on");
  await expect(attention.getByRole("textbox")).toHaveCount(0);

  const finished = page.waitForResponse(/\/tools\/finish_task$/);
  await task.getByRole("checkbox", { name: overdue, exact: true }).check();
  expect((await (await finished).json()).ok).toBe(true);

  await expect(due.getByRole("listitem")).toHaveCount(1);
  await expect(due.getByText(overdue)).toHaveCount(0);
  await expect(count(page, testInfo)).toContainText("1 to act on");

  // The Journal shows the Task Finished where it hangs off its Entry.
  const { journal } = await openJournal(page, testInfo);
  await expect(journal.getByRole("checkbox", { name: overdue, exact: true })).toBeChecked();
});

test("opening a Project in Attention shows its Tasks, and one with no open Task is flagged", async ({
  page,
}, testInfo) => {
  const { id, tasks } = await contextWith(page, testInfo, ["Buy the paint", "Sand the door"]);
  const { record: painting } = await callContextTool(page, id, "create_project", {
    name: "Painting",
  });
  await callContextTool(page, id, "create_project", { name: "Roof" });
  for (const task of tasks) {
    await callContextTool(page, id, "move_task", { id: task.id, project_id: painting.id });
  }
  const [, deferred] = tasks;
  await callContextTool(page, id, "set_task_dates", {
    id: deferred?.id,
    defer_date: "2099-03-01",
  });

  await page.goto("/");
  const projects = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("region", { name: "Projects", exact: true });
  // Each Project's toggle, which names its count of actionable Tasks, apart from its Move.
  await expect(projects.getByRole("button", { name: /actionable$/ })).toHaveText([
    /^Painting/,
    /^Roof/,
  ]);
  await expect(projects.getByRole("button", { name: /^Painting/ })).toContainText("1 actionable");
  await expect(projects.getByText("Needs a next Task or finishing")).toHaveCount(1);

  // Its Tasks, the Deferred one among them, are reached by opening it.
  const expand = projects.getByRole("button", { name: /^Painting/ });
  await expect(projects.getByText("Sand the door")).toHaveCount(0);
  await expand.click();
  await expect(expand).toHaveAttribute("aria-expanded", "true");
  await expect(
    projects.getByRole("checkbox", { name: "Buy the paint", exact: true }),
  ).toBeVisible();
  await expect(projects.getByText(/^Deferred until .+2099/)).toBeVisible();
});
