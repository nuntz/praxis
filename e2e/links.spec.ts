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
  await composer.pressSequentially(`and @ali-${tag}`);
  await composer.press("Escape");
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
