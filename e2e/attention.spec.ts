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
  // Its row leads with Overdue on the date, and tells a screen reader every mark.
  const row = task.getByRole("button", { name: overdue, exact: true });
  await expect(row.getByText(/2020, Overdue$/)).toBeVisible();
  await expect(row).toHaveAccessibleDescription(/^Due .+2020, Overdue$/);
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

test("opening a Project in Attention shows its page with its Tasks, and one with no open Task is flagged", async ({
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
  // Each Project's row, by name, with its count of actionable Tasks, or its flag.
  const paintingRow = projects.getByRole("button", { name: "Painting", exact: true });
  const roofRow = projects.getByRole("button", { name: "Roof", exact: true });
  await expect(projects.getByRole("listitem")).toHaveText([/^Painting/, /^Roof/]);
  await expect(paintingRow).toContainText("1 actionable");
  await expect(roofRow).toContainText("Needs a next Task");
  await expect(roofRow).toHaveAccessibleDescription(/Needs a next Task or finishing/);

  // Its Tasks, the Deferred one among them, are reached by opening its page.
  await expect(projects.getByText("Sand the door")).toHaveCount(0);
  await paintingRow.click();
  const opened = page.getByRole("dialog", { name: "Painting" });
  const itsTasks = opened.getByRole("list", { name: "Tasks in Painting" });
  await expect(
    itsTasks.getByRole("checkbox", { name: "Buy the paint", exact: true }),
  ).toBeVisible();
  await expect(itsTasks.getByRole("button", { name: "Sand the door", exact: true })).toContainText(
    /Deferred until .+2099/,
  );
  await expect(opened.getByRole("button", { name: /^Finish/ })).toContainText(
    "Drops its 2 open Tasks",
  );
});

/** The day `days` after a day, by the calendar. */
function after(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

test("the person opens the weeks ahead from Due and sees what is coming, a Recurrence's Occurrences to come among it", async ({
  page,
}, testInfo) => {
  const [weekly, vet] = ["Water the plants", "Book the vet"];
  const { id, tasks } = await contextWith(page, testInfo, [weekly, vet]);
  const [watering, booking] = tasks;
  const { today } = await callContextTool(page, id, "get_settings", {});
  await callContextTool(page, id, "set_task_dates", {
    id: watering?.id,
    due_date: after(today, 2),
  });
  await callContextTool(page, id, "set_recurrence", {
    id: watering?.id,
    recurrence: { kind: "days", every: 7 },
  });
  await callContextTool(page, id, "set_task_dates", {
    id: booking?.id,
    defer_date: after(today, 5),
  });
  // Due past the 28 days the view covers.
  await callContextTool(page, id, "create_project", { name: "Hedge", due_date: after(today, 29) });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  // Nothing is due, and the weeks ahead still open from the Due section, in Attention itself.
  const due = attention.getByRole("region", { name: "Due", exact: true });
  const open = due.getByRole("button", { name: "The weeks ahead" });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect(due.getByRole("listitem")).toHaveCount(0);
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");

  const ahead = attention.getByRole("region", { name: "The weeks ahead", exact: true });
  const items = ahead.getByRole("listitem");
  await expect(items).toHaveText([
    new RegExp(`^${weekly}`),
    new RegExp(`^${vet}.*Deferred until`),
    new RegExp(`^${weekly}.*Not made yet`),
    new RegExp(`^${weekly}.*Not made yet`),
    new RegExp(`^${weekly}.*Not made yet`),
  ]);
  await expect(ahead.getByText("Hedge")).toHaveCount(0);
  // Only what exists is finished from here: an Occurrence to come has no checkbox.
  await expect(ahead.getByRole("checkbox", { name: weekly, exact: true })).toHaveCount(1);

  // Finished with no network, it leaves at once, as it leaves Attention (section 8.8).
  await page.context().setOffline(true);
  await ahead.getByRole("checkbox", { name: weekly, exact: true }).click();
  await expect(items).toHaveText([
    new RegExp(`^${vet}`),
    new RegExp(`^${weekly}.*Not made yet`),
    new RegExp(`^${weekly}.*Not made yet`),
    new RegExp(`^${weekly}.*Not made yet`),
  ]);

  // Sent, the next Occurrence is made and the weeks ahead follow.
  const finished = page.waitForResponse(/\/tools\/finish_task$/);
  await page.context().setOffline(false);
  expect((await (await finished).json()).ok).toBe(true);
  await expect(items).toHaveText([
    new RegExp(`^${vet}`),
    new RegExp(`^${weekly}`),
    new RegExp(`^${weekly}.*Not made yet`),
    new RegExp(`^${weekly}.*Not made yet`),
  ]);
  await expect(ahead.getByRole("checkbox", { name: weekly, exact: true })).not.toBeChecked();

  await open.click();
  await expect(ahead).toHaveCount(0);
  // Left open, so the accessibility check at the end sees it.
  await open.click();
  await expect(items).toHaveCount(4);
});

/** A write the page sends, once its answer is in: it was accepted. */
async function accepted(page: Page, tool: string, act: () => Promise<void>) {
  const answer = page.waitForResponse(new RegExp(`/tools/${tool}$`));
  await act();
  expect((await (await answer).json()).ok).toBe(true);
}

test("from a Task's page the person renames it, gives it a Recurrence from its Due Date and removes it, delegates it and takes it back", async ({
  page,
}, testInfo) => {
  const { id, tasks } = await contextWith(page, testInfo, ["Water the fern"]);
  const [fern] = tasks;
  const { today } = await callContextTool(page, id, "get_settings", {});
  await callContextTool(page, id, "create_person", { name: "Maya Okafor" });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  await attention.getByRole("button", { name: "Water the fern", exact: true }).click();
  const opened = attention.getByRole("dialog", { name: "Water the fern" });

  // The title is changed where it is shown.
  await accepted(page, "rename_task", async () => {
    await opened.getByRole("textbox", { name: "Title" }).fill("Water the ferns");
    await page.keyboard.press("Enter");
  });
  const renamed = attention.getByRole("dialog", { name: "Water the ferns" });
  await expect(renamed).toBeVisible();

  // A Recurrence counts from a Due Date, so one is asked for first; then the rules it gives.
  await renamed.getByRole("button", { name: /^Recurrence None/ }).click();
  await expect(renamed.getByText("A Recurrence counts from a Due Date")).toBeVisible();
  await accepted(page, "set_task_dates", () =>
    renamed.getByLabel("Due Date", { exact: true }).fill(today),
  );
  const weekly = renamed.getByRole("button", { name: /^Every week on / });
  await accepted(page, "set_recurrence", () => weekly.click());
  await expect(renamed.getByRole("button", { name: /^Recurrence Every week on / })).toBeVisible();
  expect((await callContextTool(page, id, "get_task", { id: fern?.id })).recurrence).toMatchObject({
    kind: "weeks",
    every: 1,
  });

  await renamed.getByRole("button", { name: /^Recurrence Every week/ }).click();
  await expect(renamed.getByRole("button", { name: /^Every week on / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await accepted(page, "remove_recurrence", () =>
    renamed.getByRole("button", { name: "No Recurrence" }).click(),
  );
  await expect(renamed.getByRole("button", { name: /^Recurrence None/ })).toBeVisible();

  // Delegated to a Person picked by name, then taken back.
  await renamed.getByRole("button", { name: /^Delegated to Nobody/ }).click();
  await renamed.getByRole("combobox", { name: "Find a Person" }).fill("Maya");
  await accepted(page, "delegate_task", () =>
    renamed.getByRole("option", { name: "Maya Okafor" }).click(),
  );
  await expect(renamed.getByRole("button", { name: /^Delegated to Maya Okafor/ })).toBeVisible();
  await expect(renamed.getByText(/^Delegated to Maya Okafor since/)).toBeVisible();

  await renamed.getByRole("button", { name: /^Delegated to Maya Okafor/ }).click();
  await accepted(page, "take_back_task", () =>
    renamed.getByRole("button", { name: "Take back from Maya Okafor" }).click(),
  );
  await expect(renamed.getByRole("button", { name: /^Delegated to Nobody/ })).toBeVisible();

  // Back, the column shows the Task as renamed, and the focus is on its row.
  await page.keyboard.press("Escape");
  await expect(renamed).toHaveCount(0);
  const row = attention.getByRole("button", { name: "Water the ferns", exact: true });
  await expect(row).toBeFocused();

  // Left on its Recurrence page, so the accessibility check sees the rules offered.
  await row.click();
  await renamed.getByRole("button", { name: /^Recurrence None/ }).click();
  await expect(renamed.getByRole("button", { name: "No Recurrence" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a Delegated Task's row names the Person and the day, and its Delegated to page offers to take it back", async ({
  page,
}, testInfo) => {
  const { id, tasks } = await contextWith(page, testInfo, ["Collect the signatures"]);
  const { record: tomas } = await callContextTool(page, id, "create_person", {
    name: "Tomás Ribeiro",
  });
  await callContextTool(page, id, "delegate_task", { id: tasks[0]?.id, person_id: tomas.id });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const delegated = attention.getByRole("region", { name: "Delegated", exact: true });
  const row = delegated.getByRole("button", { name: "Collect the signatures", exact: true });
  await expect(row).toContainText(/Tomás Ribeiro, \S/);
  await expect(row).toHaveAccessibleDescription(/^Delegated to Tomás Ribeiro since /);

  await row.click();
  const opened = attention.getByRole("dialog", { name: "Collect the signatures" });
  await opened.getByRole("button", { name: /^Delegated to Tomás Ribeiro/ }).click();
  await expect(opened.getByRole("button", { name: "Take back from Tomás Ribeiro" })).toBeVisible();
  // Left on it, so the accessibility check sees its picker of Persons.
  await expect(opened.getByRole("listbox", { name: "Persons" })).toBeVisible();
});

test("with no network a Task's page shows the Task as Attention holds it, and its round control finishes it Unsent", async ({
  page,
}, testInfo) => {
  const { id, tasks } = await contextWith(page, testInfo, ["Buy the brackets"]);
  const { record: shelves } = await callContextTool(page, id, "create_project", {
    name: "Shelves",
  });
  await callContextTool(page, id, "move_task", { id: tasks[0]?.id, project_id: shelves.id });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  await attention.getByRole("button", { name: "Shelves", exact: true }).click();
  const project = attention.getByRole("dialog", { name: "Shelves" });
  const itsTasks = project.getByRole("list", { name: "Tasks in Shelves" });
  await expect(itsTasks.getByRole("listitem")).toHaveCount(1);

  await page.context().setOffline(true);
  await itsTasks.getByRole("button", { name: "Buy the brackets", exact: true }).click();
  const opened = attention.getByRole("dialog", { name: "Buy the brackets" });
  await expect(opened.getByRole("textbox", { name: "Title" })).toHaveValue("Buy the brackets");
  await expect(opened.getByRole("alert")).toHaveCount(0);
  const control = opened.getByRole("checkbox", { name: "Buy the brackets", exact: true });
  await control.check();
  await expect(control).toBeChecked();
  await expect(opened.getByText("Finished, Unsent")).toBeVisible();

  // Sent once the network is back, as any finish kept Unsent is.
  const finished = page.waitForResponse(/\/tools\/finish_task$/);
  await page.context().setOffline(false);
  expect((await (await finished).json()).ok).toBe(true);
  await expect(opened.getByText("Finished, Unsent")).toHaveCount(0);
  await expect(control).toBeChecked();
});

test("from a Task's page the person sets it waiting and stops it, moves it into a Project and out, and turns it into a Project; a Task left waiting leaves Attention, saying so", async ({
  page,
}, testInfo) => {
  const { id } = await contextWith(page, testInfo, ["Book the venue", "Confirm the headcount"]);
  await callContextTool(page, id, "create_project", { name: "Offsite" });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const loose = attention.getByRole("region", { name: "Loose", exact: true });
  await loose.getByRole("button", { name: "Book the venue", exact: true }).click();
  const venue = attention.getByRole("dialog", { name: "Book the venue" });

  // It waits on a Task picked by name, and the wait is stopped from the same line.
  await venue.getByRole("button", { name: /^Waits on Nothing/ }).click();
  await venue
    .getByRole("combobox", { name: "Find a Task or Project to wait on" })
    .fill("headcount");
  await accepted(page, "wait_on", () =>
    venue.getByRole("option", { name: /^Confirm the headcount/ }).click(),
  );
  await expect(
    venue.getByRole("button", { name: /^Waits on Confirm the headcount/ }),
  ).toBeVisible();
  await venue.getByRole("button", { name: /^Waits on Confirm the headcount/ }).click();
  await accepted(page, "stop_waiting", () =>
    venue.getByRole("button", { name: "Stop waiting on Confirm the headcount" }).click(),
  );
  await venue.getByRole("button", { name: /^Back to Book the venue/ }).click();
  await expect(venue.getByRole("button", { name: /^Waits on Nothing/ })).toBeVisible();

  // Into a Project picked by name, and out of it.
  await venue.getByRole("button", { name: /^Project None/ }).click();
  await venue.getByRole("combobox", { name: "Find a Project" }).fill("Offsite");
  await accepted(page, "move_task", () => venue.getByRole("option", { name: "Offsite" }).click());
  await expect(venue.getByRole("button", { name: /^Project Offsite/ })).toBeVisible();
  await venue.getByRole("button", { name: /^Project Offsite/ }).click();
  await accepted(page, "move_task", () =>
    venue.getByRole("button", { name: "Take it out of its Project" }).click(),
  );
  await expect(venue.getByRole("button", { name: /^Project None/ })).toBeVisible();

  // Turned into a Project, its page is the new Project's, the Task its first.
  await accepted(page, "make_project_from_task", () =>
    venue.getByRole("button", { name: /^Turn into a Project/ }).click(),
  );
  await expect(
    venue.getByRole("list", { name: "Tasks in Book the venue" }).getByRole("listitem"),
  ).toHaveText([/^Book the venue/]);
  await page.keyboard.press("Escape");
  const projects = attention.getByRole("region", { name: "Projects", exact: true });
  await expect(projects.getByRole("button", { name: "Book the venue", exact: true })).toBeVisible();

  // Set waiting on that Project, with no Due Date, it leaves Attention, and the column says why.
  await loose.getByRole("button", { name: "Confirm the headcount", exact: true }).click();
  const headcount = attention.getByRole("dialog", { name: "Confirm the headcount" });
  await headcount.getByRole("button", { name: /^Waits on Nothing/ }).click();
  await headcount
    .getByRole("combobox", { name: "Find a Task or Project to wait on" })
    .fill("Book the venue");
  await accepted(page, "wait_on", () =>
    headcount.getByRole("option", { name: /^Book the venue · Project/ }).click(),
  );
  await page.keyboard.press("Escape");
  await expect(headcount).toHaveCount(0);
  await expect(attention.getByRole("status").filter({ hasText: "leaves Attention" })).toHaveText(
    "“Confirm the headcount” waits on “Book the venue”, and leaves Attention until that ends.",
  );
  await expect(attention.getByRole("button", { name: "Confirm the headcount" })).toHaveCount(0);
});

test("from its page a Task is dropped and reopened, and deleted and restored, from the line that says so", async ({
  page,
}, testInfo) => {
  const { id, tasks } = await contextWith(page, testInfo, ["Return the books"]);
  const [books] = tasks;

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const row = attention.getByRole("button", { name: "Return the books", exact: true });
  const said = attention.getByRole("status").filter({ hasText: "Return the books" });

  await row.click();
  await accepted(page, "drop_task", () => attention.getByRole("button", { name: /^Drop/ }).click());
  await expect(attention.getByRole("dialog")).toHaveCount(0);
  await expect(said).toHaveText("Dropped “Return the books”. Reopen");
  await expect(row).toHaveCount(0);
  await accepted(page, "reopen_task", () => said.getByRole("button", { name: "Reopen" }).click());
  await expect(row).toBeVisible();
  await expect(said).toHaveCount(0);

  await row.click();
  await accepted(page, "delete_task", () =>
    attention.getByRole("button", { name: /^Delete/ }).click(),
  );
  await expect(said).toHaveText("“Return the books” is in the Trash. Restore");
  await expect(row).toHaveCount(0);
  await accepted(page, "restore", () => said.getByRole("button", { name: "Restore" }).click());
  await expect(row).toBeVisible();
  expect((await callContextTool(page, id, "get_task", { id: books?.id })).state.is).toBe("open");

  // What it says stays while a row is opened and shut, so its way back can still be taken.
  await row.click();
  await accepted(page, "drop_task", () => attention.getByRole("button", { name: /^Drop/ }).click());
  await expect(said).toHaveText("Dropped “Return the books”. Reopen");
  // Left showing it, so the accessibility check sees the status line and its Reopen.
});

test("from its page a Project is renamed, given a Due Date, finished and reopened, dropped, and deleted and restored", async ({
  page,
}, testInfo) => {
  const { id, tasks } = await contextWith(page, testInfo, ["Buy the seeds"]);
  const { record: garden } = await callContextTool(page, id, "create_project", { name: "Garden" });
  await callContextTool(page, id, "move_task", { id: tasks[0]?.id, project_id: garden.id });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const projects = attention.getByRole("region", { name: "Projects", exact: true });
  await projects.getByRole("button", { name: "Garden", exact: true }).click();
  const opened = attention.getByRole("dialog", { name: "Garden" });

  await accepted(page, "rename_project", async () => {
    await opened.getByRole("textbox", { name: "Name" }).fill("Garden plan");
    await page.keyboard.press("Enter");
  });
  const plan = attention.getByRole("dialog", { name: "Garden plan" });
  await accepted(page, "set_project_due_date", () =>
    plan.getByLabel("Due Date", { exact: true }).fill("2099-05-01"),
  );
  await expect(plan.getByText(/^Due .+2099$/)).toBeVisible();

  // Finishing it drops its open Task, as it says beside Finish; reopening leaves that Task dropped.
  const row = projects.getByRole("button", { name: "Garden plan", exact: true });
  const said = attention.getByRole("status").filter({ hasText: "Garden plan" });
  await expect(plan.getByRole("button", { name: /^Finish/ })).toContainText(
    "Drops its 1 open Task",
  );
  await accepted(page, "finish_project", () =>
    plan.getByRole("button", { name: /^Finish/ }).click(),
  );
  await expect(said).toHaveText("Finished Garden plan. Its 1 open Task was dropped. Reopen");
  await expect(row).toHaveCount(0);
  await accepted(page, "reopen_project", () =>
    said.getByRole("button", { name: "Reopen" }).click(),
  );
  await expect(row).toContainText("Needs a next Task");

  // Its Task stayed dropped; from the Task's own page it is reopened, and the Project has it again.
  await row.click();
  await plan
    .getByRole("list", { name: "Tasks in Garden plan" })
    .getByRole("button", { name: "Buy the seeds", exact: true })
    .click();
  const seeds = attention.getByRole("dialog", { name: "Buy the seeds" });
  await expect(seeds.getByText("Dropped", { exact: true })).toBeVisible();
  await accepted(page, "reopen_task", () => seeds.getByRole("button", { name: /^Reopen/ }).click());
  await expect(seeds.getByRole("button", { name: /^Drop/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(row).toContainText("1 actionable");

  await row.click();
  await accepted(page, "drop_project", () => plan.getByRole("button", { name: /^Drop/ }).click());
  await expect(said).toHaveText("Dropped Garden plan. Its 1 open Task was dropped. Reopen");
  await accepted(page, "reopen_project", () =>
    said.getByRole("button", { name: "Reopen" }).click(),
  );

  await row.click();
  await accepted(page, "delete_project", () =>
    plan.getByRole("button", { name: /^Delete/ }).click(),
  );
  await expect(said).toHaveText(
    "Garden plan is in the Trash. Its Tasks stay, in no Project. Restore",
  );
  await expect(row).toHaveCount(0);
  await accepted(page, "restore", () => said.getByRole("button", { name: "Restore" }).click());
  await expect(row).toBeVisible();
});
