import { expect, openJournal, test } from "./fixtures.ts";

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
  await task.getByLabel("Due Date").fill("2020-01-06");
  await expect(task.getByText(/^Due .+, Overdue$/)).toBeVisible();
  await task.getByLabel("Defer Date").fill("2099-03-01");
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
  await kept.getByLabel("Due Date").fill("");
  await expect(kept.getByText(/^Due .*2020/)).toHaveCount(0);
  await expect(kept.getByText(/^Deferred until .+2099/)).toBeVisible();
});

test("a Context's settings show the Device's other time zone beside its own, with one tap to switch", async ({
  page,
}, testInfo) => {
  // There is one Context for every journey until a journey can make its own (#56). Two copies of
  // this one in one project share a Device zone, so one would take the other's switch away. The
  // two projects' Devices are in different zones, so a single copy in each never collides.
  test.skip(
    testInfo.repeatEachIndex > 0,
    "Runs once per project until each journey has its own Context (#56).",
  );
  const device = testInfo.project.use.timezoneId as string;
  // Start the Context in UTC, which neither project's Device is in, so a retry finds it as the
  // first run did, whatever the other project has switched it to.
  const reset = await page.request.post("/api/tools/set_time_zone", { data: { time_zone: "UTC" } });
  expect(await reset.json()).toMatchObject({ ok: true });

  await page.goto("/");
  // Travel changes nothing by itself and raises nothing outside settings.
  await expect(page.getByRole("region", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Use ${device}` })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings.getByTestId("device-time-zone")).toHaveText(device);
  await expect(settings.getByTestId("time-zone")).not.toHaveText(device);

  await settings.getByRole("button", { name: `Use ${device}` }).click();

  await expect(settings.getByTestId("time-zone")).toHaveText(device);
  await expect(settings.getByTestId("device-time-zone")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveCount(0);
});
