import type { Page, TestInfo } from "@playwright/test";
import { mendedByWaiting, RUN_FAILURES, type StandingNotice } from "@praxis/domain";
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

test("each standing Notice in Attention is a card titled by its kind, its words under the title", async ({
  page,
}, testInfo) => {
  const since = new Date().toISOString();
  // Each kind, its title, and how its words begin, which the title is not part of.
  const titled: [StandingNotice, string, RegExp][] = [
    [
      { kind: "key_refused", since },
      "Model key refused",
      /^The model's provider has refused this Deployment's key since /,
    ],
    [
      { kind: "voice_key_refused", since },
      "Voice key refused",
      /^The voice provider has refused this Deployment's voice key since /,
    ],
    [
      { kind: "cap_reached", spent: 20, cap: 20 },
      "Spend cap reached",
      /^This month's spend has reached its cap of /,
    ],
    [
      { kind: "nearing_cap", spent: 17, cap: 20 },
      "Spend near its cap",
      /^This month's spend, .+, has passed 80% of its cap of /,
    ],
    [
      { kind: "clock_failed", clock: "brief", failure: "model_unavailable", since },
      "Brief not run",
      /^The Brief could not run since /,
    ],
    [
      { kind: "clock_failed", clock: "review", failure: "key_refused", since },
      "Review not run",
      /^The Review could not run since /,
    ],
    [{ kind: "no_backup", last_made: null }, "No recent Backup", /^No Backup has been made yet/],
    [
      { kind: "context_stuck", context: "Elsewhere", release: "r1", backup_kept: null },
      "Elsewhere stuck on an upgrade",
      /^Elsewhere could not be upgraded under release r1: /,
    ],
  ];
  await noticesAre(
    page,
    titled.map(([notice]) => notice),
  );
  await page.goto("/");
  const shown = await attention(page, testInfo);
  const notices = shown.getByTestId("standing-notice");
  await expect(notices).toHaveCount(titled.length);

  for (const [at, [notice, title, words]] of titled.entries()) {
    const card = notices.nth(at);
    // The card is the status, named by its title, so the title is what is heard first.
    await expect(
      shown.getByRole("status", { name: title, exact: true }),
      notice.kind,
    ).toBeVisible();
    await expect(card.getByTestId("standing-notice-title"), notice.kind).toHaveText(title);
    await expect(card.getByTestId("standing-notice-words"), notice.kind).toHaveText(words);
    await expect(card.getByTestId("standing-notice-words"), notice.kind).not.toContainText(title);
  }
});

test("the no-Backup Notice in Attention opens Backups and Export in settings", async ({
  page,
}, testInfo) => {
  await noticesAre(page, [{ kind: "no_backup", last_made: null }]);
  await page.goto("/");
  const notice = (await attention(page, testInfo)).getByTestId("standing-notice").filter({
    has: page
      .getByTestId("standing-notice-words")
      .filter({ hasText: /No Backup has been made yet/ }),
  });

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

  await expect(notice.getByTestId("standing-notice-words")).toHaveText(
    /^The Brief could not run since .+: the model's provider refused Praxis's request\. It is not tried again: the next one runs at its time\.\s*$/,
  );
  await expect(notice).not.toContainText("could not be reached");
  await expect(notice).not.toContainText("a little later");
});

test("a Review whose key the provider refused says so in Attention, and not that it is tried again", async ({
  page,
}, testInfo) => {
  await noticesAre(page, [
    {
      kind: "clock_failed",
      clock: "review",
      failure: "key_refused",
      since: new Date().toISOString(),
    },
  ]);
  await page.goto("/");
  const notice = (await attention(page, testInfo)).getByTestId("standing-notice");

  // Where the key is set is the refused key's own Notice to say, not this one's.
  await expect(notice.getByTestId("standing-notice-words")).toHaveText(
    /^The Review could not run since .+: the model's provider refused this Deployment's key\. It is not tried again: the next one runs at its time\.\s*$/,
  );
});

test("a Brief that failed says it is tried again in Attention exactly when waiting mends its failure", async ({
  page,
}, testInfo) => {
  const since = new Date().toISOString();
  await noticesAre(
    page,
    RUN_FAILURES.map((failure) => ({ kind: "clock_failed", clock: "brief", failure, since })),
  );
  await page.goto("/");
  const notices = (await attention(page, testInfo)).getByTestId("standing-notice");
  await expect(notices).toHaveCount(RUN_FAILURES.length);

  for (const [at, failure] of RUN_FAILURES.entries()) {
    const notice = notices.nth(at).getByTestId("standing-notice-words");
    if (mendedByWaiting(failure)) {
      await expect(notice, failure).toContainText(
        "It is tried again a little later each time, until it runs or the next one is due.",
      );
      await expect(notice, failure).not.toContainText("not tried again");
    } else {
      await expect(notice, failure).toContainText(
        "It is not tried again: the next one runs at its time.",
      );
      await expect(notice, failure).not.toContainText("a little later");
    }
  }
});

test("the standing Notices read again as the tab comes into view keep their cards, an unchanged one as it was and a changed one with its new words", async ({
  page,
}, testInfo) => {
  const since = new Date().toISOString();
  const refused: StandingNotice = { kind: "key_refused", since };
  await noticesAre(page, [refused, { kind: "nearing_cap", spent: 17, cap: 20 }]);
  await page.goto("/");
  const shown = await attention(page, testInfo);
  const notices = shown.getByTestId("standing-notice");
  await expect(notices).toHaveCount(2);
  await expect(notices.nth(1)).toContainText("$17.00");
  // Each card as drawn, marked so the same element can be told from one drawn again.
  await notices.evaluateAll((cards) => {
    for (const card of cards) card.setAttribute("data-drawn", "first");
  });

  await page.unroute(/\/list_notices$/);
  await noticesAre(page, [refused, { kind: "nearing_cap", spent: 18, cap: 20 }]);
  const read = page.waitForResponse(/\/list_notices$/);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await read;
  await expect(notices.nth(1)).toContainText("$18.00");
  await expect(notices).toHaveCount(2);
  for (const at of [0, 1]) await expect(notices.nth(at)).toHaveAttribute("data-drawn", "first");
});
