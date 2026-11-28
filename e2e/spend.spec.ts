import type { Spend, StandingNotice } from "@praxis/domain";
import {
  closeSettings,
  expect,
  lastShown,
  makeContext,
  openSettings,
  showTab,
  test,
} from "./fixtures.ts";

// The spend cap (section 5.7, ADR 0017): one cap for the whole Deployment, set in its settings,
// with the month's spend against it. At the cap the Conversation's composer is replaced by a
// Notice that links to the cap in settings, and Attention's standing Notice of it leads there too
// (section 8.6).

const capReached = /This month's spend has reached its cap/;

const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

test("the person sets the monthly cap in settings, and sees the month's spend against it", async ({
  page,
}) => {
  // The spend is read as the screen opens.
  const opened = page.waitForResponse(/\/get_spend$/);
  await page.goto("/");
  const spend = await openSettings(page, "Spend");
  const field = spend.getByLabel("Monthly cap, US dollars", { exact: true });
  // The field holds the cap as it was read, as its value and not a hint.
  const first = ((await (await opened).json()) as { value: Spend }).value;
  await expect(field).toHaveValue(String(first.cap));
  await expect(field).not.toHaveAttribute("placeholder", /./);

  // Always far past anything the other journeys spend, so none of them reaches it.
  const cap = 1000 + Math.floor(Math.random() * 1000) + 0.25;
  await field.fill(String(cap));
  // The screen reads the spend again once the cap is set. Another journey may set the shared cap
  // in between, so the screen is held to what that read answered.
  let setAnswered = false;
  const set = page.waitForResponse(/\/set_spend_cap$/).then((answer) => {
    setAnswered = true;
    return answer;
  });
  const read = page.waitForResponse((answer) => setAnswered && answer.url().endsWith("/get_spend"));
  await spend.getByRole("button", { name: "Set cap" }).click();
  expect(await (await set).json()).toMatchObject({ ok: true, value: { record: { cap } } });
  const shown = ((await (await read).json()) as { value: Spend }).value;

  // The section says what the cap now is, from what the set answered.
  await expect(spend.getByRole("status")).toHaveText(`The cap is now ${money(cap)}.`);
  // The month's row is titled by a name, its value on its right.
  await expect(spend.getByText("Spent this month", { exact: true })).toBeVisible();
  await expect(spend.getByTestId("spend-against-cap")).toHaveText(
    `${money(shown.spent)} of ${money(shown.cap)}`,
  );
  // Typing again lets what was said go.
  await field.fill(String(cap + 1));
  await expect(spend.getByText(/^The cap is now /)).toHaveCount(0);
});

test("Set cap with nothing changed sends nothing, and a cap that is not an amount is said at its field", async ({
  page,
}) => {
  let sent = 0;
  await page.route(/\/set_spend_cap$/, async (route) => {
    sent += 1;
    await route.continue();
  });
  await page.goto("/");
  const spend = await openSettings(page, "Spend");
  const field = spend.getByLabel("Monthly cap, US dollars", { exact: true });
  const setCap = spend.getByRole("button", { name: "Set cap" });
  await expect(field).not.toHaveValue("");

  await setCap.click();
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await expect(spend.getByRole("alert")).toHaveCount(0);

  await field.fill("forty");
  await setCap.click();
  await expect(spend.getByRole("alert")).toHaveText("Type an amount in US dollars, such as 40.");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(sent).toBe(0);
});

test("at the cap, the Conversation's composer gives way to a Notice that opens the cap in settings, as Attention's Notice of it does", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Capped ${tag}`,
    time_zone: "UTC",
    accent: "rust",
  });
  await lastShown(page, context.id);
  // The shared Deployment is never at the cap, so this screen is told it is: reaching it for real
  // would stop every other journey's Runs. The seam tests reach it for real.
  await page.route(/\/get_spend$/, async (route) => {
    const answer = await route.fetch();
    const { value } = (await answer.json()) as { value: Spend };
    await route.fulfill({
      response: answer,
      json: { ok: true, value: { ...value, spent: value.cap, notice: "cap_reached" } },
    });
  });
  // The standing Notices say the same, among any others the shared Deployment has, at the cap
  // the Deployment has: read afresh, since another journey may set it.
  await page.route(/\/list_notices$/, async (route) => {
    const answer = await route.fetch();
    const { value } = (await answer.json()) as { value: { items: StandingNotice[] } };
    const spend = await page.request.post("/api/deployment/tools/get_spend", { data: {} });
    const { cap } = ((await spend.json()) as { value: Spend }).value;
    const items = [
      ...value.items.filter((notice) => notice.kind === "key_refused"),
      { kind: "cap_reached", spent: cap, cap },
    ];
    await route.fulfill({ response: answer, json: { ok: true, value: { items } } });
  });
  await page.goto("/");
  await showTab(page, testInfo, "Agent");
  const conversation = page.getByRole("region", { name: "Conversation" });

  await expect(conversation.getByText(capReached)).toBeVisible();
  await expect(conversation.getByRole("textbox", { name: /^Message the Agent/ })).toHaveCount(0);

  const capField = page.getByLabel("Monthly cap, US dollars", { exact: true });
  await conversation.getByRole("link", { name: "Raise the cap in settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/spend$/);
  await expect(capField).toBeFocused();
  // A standing Notice shows in Attention only: Settings shows none of them.
  await expect(page.getByRole("region", { name: "Notices" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: capReached })).toHaveCount(0);

  // Attention's standing Notice of the cap leads to the same field.
  await closeSettings(page);
  await showTab(page, testInfo, "Attention");
  const notice = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByTestId("standing-notice")
    .filter({ has: page.getByTestId("standing-notice-words").filter({ hasText: capReached }) });
  await notice.getByRole("link", { name: "Raise the cap in settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/spend$/);
  await expect(capField).toBeFocused();
});
