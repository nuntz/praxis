import type { Page, TestInfo } from "@playwright/test";
import type { StandingNotice } from "@praxis/domain";
import { expect, showTab, test } from "./fixtures.ts";

// A standing Notice shows in Attention only, and leads to the section of Settings that deals with
// it, where there is one (section 8.6): no good Backup to Backups and Export. The cap's leads to
// Spend, as the spend journey holds.

/**
 * The screen is told these are the standing Notices: the shared Deployment has none of them for
 * real, and making them for real would reach every other journey's screen.
 */
async function noticesAre(page: Page, items: StandingNotice[]) {
  await page.route(/\/list_notices$/, async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ok: true, value: { items } } });
  });
}

/** Attention, brought into view on a phone, where the screen opens on it anyway. */
async function attention(page: Page, testInfo: TestInfo) {
  await showTab(page, testInfo, "Attention");
  return page.getByRole("region", { name: "Attention", exact: true });
}

test("the no-Backup Notice in Attention opens Backups and Export in settings", async ({
  page,
}, testInfo) => {
  await noticesAre(page, [{ kind: "no_backup", last_made: null }]);
  await page.goto("/");
  const notice = (await attention(page, testInfo))
    .getByTestId("standing-notice")
    .filter({ hasText: /No Backup has been made yet/ });

  await notice.getByRole("link", { name: "See Backups and Export", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/backups$/);
  await expect(page.getByRole("region", { name: "Backups and Export", exact: true })).toBeVisible();
});

test("a Notice with no section of settings to deal with it, such as a refused key, carries no link", async ({
  page,
}, testInfo) => {
  const since = new Date().toISOString();
  await noticesAre(page, [
    { kind: "key_refused", since },
    { kind: "voice_key_refused", since },
    { kind: "clock_failed", clock: "brief", failure: "key_refused", since },
    { kind: "context_stuck", context: "Elsewhere", release: "r1", backup_kept: null },
  ]);
  await page.goto("/");
  const notices = (await attention(page, testInfo)).getByTestId("standing-notice");

  await expect(notices).toHaveCount(4);
  await expect(notices.getByRole("link")).toHaveCount(0);
});

test("a Brief whose request the provider refused says so in Attention, and not that it is tried again", async ({
  page,
}, testInfo) => {
  await noticesAre(page, [
    {
      kind: "clock_failed",
      clock: "brief",
      failure: "request_refused",
      since: new Date().toISOString(),
    },
  ]);
  await page.goto("/");
  const notice = (await attention(page, testInfo)).getByTestId("standing-notice");

  await expect(notice).toHaveText(
    /^The Brief could not run since .+: the model's provider refused Praxis's request\. It is not tried again: the next one runs at its time\.\s*$/,
  );
  await expect(notice).not.toContainText("could not be reached");
  await expect(notice).not.toContainText("a little later");
});
