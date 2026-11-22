import { expect, openJournal, screenKept, test } from "./fixtures.ts";

// Every request passes Cloudflare Access first (section 7.1). Here the stand-in for Access in
// front of the Worker (apps/worker/scripts/access-stand-in.ts) signs the browser in, and a lapsed
// sign-in is its cookie: while the browser carries it, Access sends every request to its login
// page on another origin, as the real one does, which sends the browser back to the address it was
// at once signed in.

const LAPSED = "praxis-stand-in-signed-out";
const ANOTHER_EMAIL = "praxis-stand-in-another-email";

test("a network failure is not a lapsed sign-in, and a lapsed sign-in asks the person to sign in again", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  const signInAgain = page.getByRole("link", { name: "Sign in again" });
  const unsent = (words: string) => journal.getByTestId("unsent-entry").filter({ hasText: words });
  const recorded = (words: string) => journal.getByTestId("entry").filter({ hasText: words });

  // The network fails: the Entry is kept Unsent, and signing in again would not mend it.
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  const offline = `Written with no network ${tag}`;
  await composer.fill(offline);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(unsent(offline)).toBeVisible();
  await expect(signInAgain).toHaveCount(0);
  // It is tried again once the network is back, and sent.
  const sent = page.waitForResponse(/\/tools\/record_entry$/);
  await page.unroute("**/api/**");
  expect((await (await sent).json()).ok).toBe(true);
  await expect(recorded(offline)).toBeVisible();
  await expect(unsent(offline)).toHaveCount(0);

  // The sign-in lapses: the Entry waits Unsent, and the screen asks the person to sign in.
  await page.context().addCookies([{ name: LAPSED, value: "yes", url: page.url() }]);
  const signedOut = `Written while signed out ${tag}`;
  await composer.fill(signedOut);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /^Your sign-in has lapsed\. Sign in again/ }),
  ).toBeVisible();
  await expect(signInAgain).toBeVisible();
  await expect(unsent(signedOut)).toBeVisible();

  // Signing in again goes through Access's login page and back to the screen, signed in, and what
  // waited is sent.
  await signInAgain.click();
  await page.getByRole("link", { name: "Sign in as the person" }).click();
  const after = await openJournal(page, testInfo);
  await expect(after.journal.getByTestId("entry").filter({ hasText: signedOut })).toBeVisible();
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

  await expect(
    page.getByRole("alert").filter({ hasText: /^Your sign-in has lapsed\. Sign in again/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
  await expect(journal.getByTestId("unsent-entry")).toHaveCount(1);
});

test("a lapsed sign-in sends Praxis opened afresh to Access's login page, not to the screen kept for no network", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const { composer } = await openJournal(page, testInfo);
  await expect(composer).toBeVisible();
  await screenKept(page);

  await page.context().addCookies([{ name: LAPSED, value: "yes", url: page.url() }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Journal" })).toHaveCount(0);

  await page.getByRole("link", { name: "Sign in as the person" }).click();
  await expect((await openJournal(page, testInfo)).composer).toBeVisible();
});

test("a sign-in that lapsed on a Settings address, and is made again, lands on the main screen", async ({
  page,
}, testInfo) => {
  await page.goto("/settings/spend");
  await expect(page.getByRole("region", { name: "Spend", exact: true })).toBeVisible();
  await screenKept(page);

  // Opened afresh at the address, as a reload or a tab put back does, the sign-in has lapsed:
  // Access asks for it, and sends the browser back to the address it was at once it is made. The
  // cookie is the whole Deployment's, as Access's sign-in is, not the Settings address's alone.
  await page
    .context()
    .addCookies([{ name: LAPSED, value: "yes", url: new URL("/", page.url()).href }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Sign in as the person" }).click();

  // Signed in again, the person is on the main screen, never in Settings.
  await expect((await openJournal(page, testInfo)).composer).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
  // An address of Settings opened after that opens Settings, as ever.
  await page.goto("/settings/spend");
  await expect(page.getByRole("region", { name: "Spend", exact: true })).toBeVisible();
});

test("signed in to Access with another Google address, the screen gives way to a page saying whose Praxis it is", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await expect(composer).toBeVisible();
  await screenKept(page);

  // Access lets another of the person's domain's accounts through, as it did before the
  // Deployment let in one address alone: signing in again would hand back the same account.
  await page.context().addCookies([{ name: ANOTHER_EMAIL, value: "yes", url: page.url() }]);
  await composer.fill(`Written as someone else ${testInfo.project.name}`);
  await journal.getByRole("button", { name: "Record" }).click();

  await expect(
    page.getByRole("heading", { name: "This Praxis belongs to another Google address" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign out of Cloudflare Access" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
  await expect(page.getByRole("region", { name: "Journal" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveCount(0);

  // Opened afresh, it is the same page, never the screen kept for no network.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "This Praxis belongs to another Google address" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Journal" })).toHaveCount(0);
});
