import { callContextTool, expect, lastShown, makeContext, openJournal, test } from "./fixtures.ts";

// The person moves an Entry to another Context, seeing everything that goes with it before
// confirming, and it leaves this Context for that one (section 3.9). Two Contexts of the journey's
// own, so what moves is no other journey's.

test("the person moves an Entry with its Follow-up and Task to another Context, after seeing the whole unit", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const made = (name: string) =>
    makeContext(page, {
      name: `${name} ${testInfo.project.name} ${tag}`,
      time_zone: "UTC",
      accent: "plum",
    });
  const work = await made("Work");
  const home = await made("Home");
  await lastShown(page, work.id);
  const [words, title, later] = [`Fix the gate ${tag}`, `Buy hinges ${tag}`, `Gate paint ${tag}`];
  const { record: entry } = await callContextTool(page, work.id, "record_entry", {
    words,
    tasks: [{ title }],
  });
  await callContextTool(page, work.id, "record_entry", { words: later, follow_up_to: entry.id });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const moving = journal.getByTestId("entry").filter({ hasText: words }).first();
  await moving.getByRole("button", { name: "Move", exact: true }).click();
  const form = moving.getByRole("form", { name: "Move this Entry to another Context" });
  await form.getByRole("combobox", { name: "Move to" }).selectOption({ label: home.name });
  const unit = form.getByRole("list", { name: "What moves" });
  await expect(unit.getByRole("listitem")).toHaveText([
    `Entry ${words}`,
    `Entry ${later}`,
    `Task ${title}`,
  ]);
  await expect(form.getByText(/The words are kept\.$/)).toBeVisible();

  const answered = page.waitForResponse(/\/tools\/move_record$/);
  await form.getByRole("button", { name: "Move it" }).click();
  expect((await (await answered).json()).ok).toBe(true);

  await expect(journal.getByTestId("entry").filter({ hasText: words })).toHaveCount(0);
  await expect(journal.getByTestId("entry").filter({ hasText: later })).toHaveCount(0);
  await expect(journal.getByRole("status")).toHaveText(
    `“${words}” moved to ${home.name}, with 2 more records.`,
  );
  const there = await callContextTool(page, home.id, "get_entry", { id: entry.id });
  expect(there).toMatchObject({ words, tasks: [{ title }], follow_ups: [{ summary: later }] });
});

test("the person moves a Project from Attention, with its Tasks and their Entries", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const made = (name: string) =>
    makeContext(page, {
      name: `${name} ${testInfo.project.name} ${tag}`,
      time_zone: "UTC",
      accent: "plum",
    });
  const work = await made("Work");
  const home = await made("Home");
  await lastShown(page, work.id);
  const [name, words, title] = [`Shed ${tag}`, `Build a shed ${tag}`, `Pour the base ${tag}`];
  const { record: project } = await callContextTool(page, work.id, "create_project", { name });
  const { record: entry } = await callContextTool(page, work.id, "record_entry", {
    words,
    tasks: [{ title }],
  });
  await callContextTool(page, work.id, "move_task", {
    id: entry.tasks[0].id,
    project_id: project.id,
  });

  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const projects = attention.getByRole("region", { name: "Projects", exact: true });
  await projects.getByRole("button", { name: `Move ${name}` }).click();
  const form = projects.getByRole("form", { name: "Move this Project to another Context" });
  await form.getByRole("combobox", { name: "Move to" }).selectOption({ label: home.name });
  await expect(form.getByRole("list", { name: "What moves" }).getByRole("listitem")).toHaveText([
    `Project ${name}`,
    `Entry ${words}`,
    `Task ${title}`,
  ]);

  const answered = page.waitForResponse(/\/tools\/move_record$/);
  await form.getByRole("button", { name: "Move it" }).click();
  expect((await (await answered).json()).ok).toBe(true);

  await expect(attention.getByText(name, { exact: true })).toHaveCount(0);
  // Attention's standing Notices are statuses too.
  await expect(attention.getByRole("status").filter({ hasText: "moved to" })).toHaveText(
    `“${name}” moved to ${home.name}, with 2 more records.`,
  );
  const there = await callContextTool(page, home.id, "get_project", { id: project.id });
  expect(there).toMatchObject({ name, tasks: [{ title }] });
});
