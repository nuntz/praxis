import { expect, openJournal, test } from "./fixtures.ts";

// Every request passes Cloudflare Access first (section 7.1). Here the stand-in for Access in
// front of the Worker (apps/worker/scripts/access-stand-in.ts) signs the browser in, and a lapsed
// sign-in is its cookie: while the browser carries it, Access sends every request to its login
// page on another origin, as the real one does.

const LAPSED = "praxis-stand-in-signed-out";

test("a network failure is not a lapsed sign-in, and a lapsed sign-in asks the person to sign in again", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const signInAgain = page.getByRole("link", { name: "Sign in again" });

  // The network fails: the Entry is not recorded, and signing in again would not mend it.
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await composer.fill(`Written with no network ${tag}`);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByText("Praxis could not be reached.")).toBeVisible();
  await expect(signInAgain).toHaveCount(0);
  await page.unroute("**/api/**");

  // The sign-in lapses: the same Entry is not recorded, and the screen asks the person to sign in.
  await page.context().addCookies([{ name: LAPSED, value: "yes", url: page.url() }]);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByText("Your sign-in has lapsed.")).toBeVisible();
  await expect(signInAgain).toBeVisible();

  // Signing in again goes through Access's login page and back to the screen, signed in.
  await signInAgain.click();
  await page.getByRole("link", { name: "Sign in as the person" }).click();
  const after = await openJournal(page, testInfo);
  await after.composer.fill(`Written once signed in again ${tag}`);
  await after.journal.getByRole("button", { name: "Record" }).click();
  await expect(
    after.journal.getByRole("listitem").filter({ hasText: `Written once signed in again ${tag}` }),
  ).toBeVisible();
  await expect(signInAgain).toHaveCount(0);
});

test("a request the Worker itself refuses as signed out asks the person to sign in again", async ({
  page,
}, testInfo) => {
  // Access in front would have sent the browser to its login page first; the Worker refusing a
  // request Access did not sign in is the same lapse to the person.
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 401, body: "Sign in to Praxis through Cloudflare Access." }),
  );

  await composer.fill(`Written once the Worker refuses ${testInfo.project.name}`);
  await journal.getByRole("button", { name: "Record" }).click();

  await expect(journal.getByText("Your sign-in has lapsed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
});
