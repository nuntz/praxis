import type { Route } from "@playwright/test";
import { expect, openJournal, test } from "./fixtures.ts";

test("the person Mentions a Person and References a Project by picking them as they type", async ({
  page,
}, testInfo) => {
  // Every run shares one Context, so each run's names are its own. A name holds no space, so
  // nothing typed after it is taken for part of it.
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const bea = `Bea-${tag}`;
  const fence = `Fence-${tag}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const persons = journal.getByRole("listbox", { name: "Persons" });
  const tasksAndProjects = journal.getByRole("listbox", { name: "Tasks and Projects" });

  // `@` opens the picker of Persons, which offers to make one from what was typed.
  await composer.pressSequentially(`Lunch with @${bea}`);
  await persons.getByRole("option", { name: `New Person “${bea}”` }).click();
  await expect(composer).toHaveValue(`Lunch with @${bea} `);
  // `#` opens the picker of Tasks and Projects only once a character follows it.
  await composer.pressSequentially("about #");
  await expect(tasksAndProjects).toBeHidden();
  await composer.pressSequentially(fence);
  await tasksAndProjects.getByRole("option", { name: `New Project “${fence}”` }).click();
  await composer.press("ControlOrMeta+Enter");

  const lunch = journal.getByTestId("entry").filter({ hasText: `Lunch with @${bea}` });
  await expect(lunch.getByTestId("words")).toHaveText(`Lunch with @${bea} about #${fence} `);
  await expect(lunch.getByRole("listitem")).toHaveText([`@${bea}`, `#${fence}`]);

  // The Person made is offered next time and picked from the keyboard. `@ali` typed and left
  // is text: only a pick makes a link.
  await composer.pressSequentially(`Called @${bea.toLowerCase()}`);
  await expect(persons.getByRole("option", { name: bea, exact: true })).toBeVisible();
  await composer.press("Enter");
  // Escape shuts the picker even before it has anything to show: each answer is held until after
  // it, so the answer lands late, as it does under load.
  const held: Route[] = [];
  await page.route(/\/tools\/list_persons$/, (route) => {
    held.push(route);
  });
  await composer.pressSequentially(`and @ali-${tag}`);
  // The read of the whole name, the last one sent, is held too.
  await expect
    .poll(() => held.some((route) => route.request().postDataJSON().named === `ali-${tag}`))
    .toBe(true);
  await composer.press("Escape");
  for (const route of held) await route.fulfill({ response: await route.fetch() });
  await page.unroute(/\/tools\/list_persons$/);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(persons).toBeHidden();
  await composer.press("ControlOrMeta+Enter");

  const called = journal.getByTestId("entry").filter({ hasText: `Called @${bea}` });
  await expect(called.getByTestId("words")).toHaveText(`Called @${bea} and @ali-${tag}`);
  await expect(called.getByRole("listitem")).toHaveText([`@${bea}`]);

  // A second Person with the same name is told apart by the latest Entry that Mentions each.
  await composer.pressSequentially(`Coffee with @${bea}`);
  await persons.getByRole("option", { name: `New Person “${bea}”` }).click();
  await composer.press("ControlOrMeta+Enter");
  await expect(journal.getByTestId("entry").filter({ hasText: `Coffee with @${bea}` })).toHaveCount(
    1,
  );
  await composer.pressSequentially(`@${bea}`);
  await expect(
    persons.getByRole("option", { name: new RegExp(`^${bea}.*Called @`) }),
  ).toBeVisible();
  await expect(
    persons.getByRole("option", { name: new RegExp(`^${bea}.*Coffee with @`) }),
  ).toBeVisible();

  // What the server kept, read back afresh.
  await page.reload();
  await openJournal(page, testInfo);
  await expect(lunch.getByRole("listitem")).toHaveText([`@${bea}`, `#${fence}`]);
  await expect(called.getByRole("listitem")).toHaveText([`@${bea}`]);
});

test("an answer for a Mention left before it landed is not offered for the next", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const persons = journal.getByRole("listbox", { name: "Persons" });

  // Each answer is held, so the person leaves the words before the first lands.
  const held: Route[] = [];
  await page.route(/\/tools\/list_persons$/, (route) => {
    held.push(route);
  });
  const reads = (named: string) =>
    expect
      .poll(() => held.some((route) => route.request().postDataJSON().named === named))
      .toBe(true);
  await composer.pressSequentially(`@ali-${tag}`);
  await reads(`ali-${tag}`);
  await composer.blur();
  for (const route of held.splice(0)) await route.fulfill({ response: await route.fetch() });
  await page.evaluate(() => new Promise(requestAnimationFrame));

  // Back in, a second Mention: while its own answer is out, the first's is not shown for it.
  await composer.focus();
  await composer.press("End");
  await composer.pressSequentially(` @bo-${tag}`);
  await reads(`bo-${tag}`);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(persons.getByRole("option", { name: `New Person “ali-${tag}”` })).toHaveCount(0);
  for (const route of held.splice(0)) await route.fulfill({ response: await route.fetch() });
  await page.unroute(/\/tools\/list_persons$/);
  await expect(persons.getByRole("option", { name: `New Person “bo-${tag}”` })).toBeVisible();
});
