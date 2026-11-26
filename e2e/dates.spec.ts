import {
  callContextTool,
  contextOfOwn,
  expect,
  holdNext,
  lastShown,
  makeContext,
  openJournal,
  openSettings,
  test,
} from "./fixtures.ts";

test("the person gives a Task a Due Date and a Defer Date and sees it Overdue and Deferred", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const title = `Renew the lease ${tag}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill(`Lease ${tag}\n[] ${title}`);
  await journal.getByRole("button", { name: "Record" }).click();
  const task = journal
    .getByRole("listitem")
    .filter({ has: page.getByText(title) })
    .last();

  await task.getByRole("button", { name: `Dates for ${title}`, exact: true }).click();
  // Days far enough off that today, in whatever zone the Context is in, is between them.
  await task.getByLabel("Due Date", { exact: true }).fill("2020-01-06");
  await expect(task.getByText(/^Due .+, Overdue$/)).toBeVisible();
  await task.getByLabel("Defer Date", { exact: true }).fill("2099-03-01");
  await expect(task.getByText(/^Deferred until .+2099/)).toBeVisible();

  // What the server kept, read back afresh.
  await page.reload();
  await openJournal(page, testInfo);
  const kept = journal
    .getByRole("listitem")
    .filter({ has: page.getByText(title) })
    .last();
  await expect(kept.getByText(/^Due .+, Overdue$/)).toBeVisible();
  await expect(kept.getByText(/^Deferred until .+2099/)).toBeVisible();

  // Emptying a date clears it.
  await kept.getByRole("button", { name: `Dates for ${title}`, exact: true }).click();
  await kept.getByLabel("Due Date", { exact: true }).fill("");
  await expect(kept.getByText(/^Due .*2020/)).toHaveCount(0);
  await expect(kept.getByText(/^Deferred until .+2099/)).toBeVisible();
});

test("a day being typed in a Task's dates in the Journal is kept while the Task is read again", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Boiler");
  const title = `Service the boiler ${crypto.randomUUID().slice(0, 8)}`;
  const { record } = await callContextTool(page, context.id, "record_entry", {
    words: "Boiler",
    tasks: [{ title }],
  });
  const [made] = record.tasks as { id: string }[];

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const task = journal.getByRole("listitem").filter({ has: page.getByText(title) });
  await task.getByRole("button", { name: `Dates for ${title}`, exact: true }).click();
  const due = task.getByLabel("Due Date", { exact: true });

  // The person types the month and the day, the 11th of November, which reads the same whichever
  // the Device's order puts first. Meanwhile the Task's Due Date is set elsewhere, and the read of
  // the Task the live channel brings is held until it is typed.
  const read = await holdNext(page, new RegExp(`/api/contexts/${context.id}/tools/get_task$`));
  await due.focus();
  await page.keyboard.type("1111");
  await callContextTool(page, context.id, "set_task_dates", {
    id: made?.id,
    due_date: "2099-01-02",
  });
  await read.asked();
  await read.release();
  // The read is in: the Task shows the day set elsewhere, and the field what is being typed.
  await expect(task.getByText(/^Due .+2099$/)).toBeVisible();

  const sent = page.waitForResponse(/\/tools\/set_task_dates$/);
  await page.keyboard.type("2098");
  await page.keyboard.press("Tab");
  expect((await (await sent).json()).value.record.due_date).toBe("2098-11-11");
  await expect(due).toHaveValue("2098-11-11");
  await expect(task.getByText(/^Due .+2098$/)).toBeVisible();
});

test("a Context's settings show the Device's other time zone beside its own, with one tap to switch", async ({
  page,
}, testInfo) => {
  const device = testInfo.project.use.timezoneId as string;
  // A Context of this journey's own, in UTC, which neither project's Device is in.
  const { id } = await makeContext(page, {
    name: `Abroad ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);

  await page.goto("/");
  // Travel changes nothing by itself and raises nothing outside settings.
  await expect(page.getByRole("region", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Use ${device}` })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  const settings = await openSettings(page, "General");
  await expect(settings).toContainText("Abroad");
  await expect(settings.getByTestId("device-time-zone")).toHaveText(device);
  await expect(settings.getByTestId("time-zone")).not.toHaveText(device);

  await settings.getByRole("button", { name: `Use ${device}` }).click();

  await expect(settings.getByTestId("time-zone")).toHaveText(device);
  await expect(settings.getByTestId("device-time-zone")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveCount(0);
});
