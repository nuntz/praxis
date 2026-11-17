import { expect, lastShown, makeContext, openJournal, test } from "./fixtures.ts";

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

  await task.getByRole("button", { name: "Dates" }).click();
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
  await kept.getByRole("button", { name: "Dates" }).click();
  await kept.getByLabel("Due Date", { exact: true }).fill("");
  await expect(kept.getByText(/^Due .*2020/)).toHaveCount(0);
  await expect(kept.getByText(/^Deferred until .+2099/)).toBeVisible();
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

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: /^Settings for Abroad/ });
  await expect(settings.getByTestId("device-time-zone")).toHaveText(device);
  await expect(settings.getByTestId("time-zone")).not.toHaveText(device);

  await settings.getByRole("button", { name: `Use ${device}` }).click();

  await expect(settings.getByTestId("time-zone")).toHaveText(device);
  await expect(settings.getByTestId("device-time-zone")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveCount(0);
});
