import type { Locator } from "@playwright/test";
import {
  callContextTool,
  contextOfOwn,
  enterSearch,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  test,
} from "./fixtures.ts";

// Rules of DESIGN.md held by measuring the screen as rendered: the 44px Rule and the Round Controls
// Rule in the phone's top bar and Attention, the focus outline on the search field, and the type
// scale on a tab's badge (#174).

/** Ink, the focus outline's colour, in light. */
const INK = "rgb(26, 29, 35)";

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("What is measured is shown");
  return box;
}

test("on a phone, the top bar shows the mark alone, still named Praxis, and Settings stays a 44px circle beside a long Context name", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone's top bar shows the mark alone.");
  const name = `Everything about the house on the hill ${crypto.randomUUID().slice(0, 8)}`;
  const context = await makeContext(page, { name, time_zone: "UTC", accent: "plum" });
  await lastShown(page, context.id);
  await page.goto("/");

  const bar = page.getByRole("banner");
  const heading = bar.getByRole("heading", { name: "Praxis", exact: true });
  const settings = bar.getByRole("button", { name: "Settings", exact: true });
  const contextName = bar.getByText(name, { exact: true });
  await expect(heading).toBeVisible();
  await expect(contextName).toBeVisible();

  // The mark, its 32px tile, with no word beside it.
  expect((await boxOf(heading)).width).toBeLessThanOrEqual(33);
  const gear = await boxOf(settings);
  expect(gear.width).toBeCloseTo(44, 0);
  expect(gear.height).toBeCloseTo(44, 0);
  expect(await settings.evaluate((button) => getComputedStyle(button).borderRadius)).toBe("999px");

  // The switcher takes the width up to Settings, its name cut with an ellipsis: between them only
  // the top bar's two 10px gaps either side of its empty fill, and a pixel for rounding.
  const switcher = await boxOf(bar.getByRole("button", { name: `Context: ${name}`, exact: true }));
  expect(gear.x - (switcher.x + switcher.width)).toBeLessThanOrEqual(21);
  expect(
    await contextName.evaluate(
      (span) =>
        getComputedStyle(span).textOverflow === "ellipsis" && span.scrollWidth > span.clientWidth,
    ),
  ).toBe(true);
});

test("from 720px up, the top bar shows the mark and the word Praxis", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "The widths from 720px up are set on the desktop's Device.");
  for (const width of [720, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const heading = page.getByRole("banner").getByRole("heading", { name: "Praxis", exact: true });
    await expect(heading).toBeVisible();
    // The 32px mark, its gap and the word.
    expect((await boxOf(heading)).width, `at ${width}px`).toBeGreaterThan(80);
  }
});

test("on a phone, a Task's control in Attention is a 44px target with its 20px circle, and its row opens where it ends", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone holds a Task's control to 44px.");
  const { id } = await contextOfOwn(page, testInfo, "Circles");
  const title = "Post the parcel";
  await callContextTool(page, id, "record_entry", { words: "Errands", tasks: [{ title }] });
  await page.goto("/");

  const row = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("listitem")
    .filter({ hasText: title });
  const control = row.getByRole("checkbox", { name: title, exact: true });
  const open = row.getByRole("button", { name: title, exact: true });
  await expect(open).toBeVisible();

  const target = await boxOf(control);
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  const circle = await control.evaluate((box) => {
    const drawn = getComputedStyle(box, "::after");
    return `${drawn.width} ${drawn.height} ${drawn.borderRadius}`;
  });
  expect(circle).toBe("20px 20px 50%");
  expect((await boxOf(open)).x).toBeCloseTo(target.x + target.width, 0);

  // A tap at the target's edge, beside the circle, finishes the Task and opens no page: a phone's
  // browser gives a tap on a bare label to the nearest control, which was the open button.
  const finished = page.waitForResponse(/\/tools\/finish_task$/);
  await page.touchscreen.tap(target.x + target.width - 3, target.y + target.height / 2);
  expect((await (await finished).json()).ok).toBe(true);
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the search field, focused, has the 2px ink outline 2px off round the whole field", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  // The phone as it is; on the desktop's Device, in between and wide.
  for (const width of onPhone(testInfo) ? [null] : [720, 1280]) {
    if (width) await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await openJournal(page, testInfo);
    const field = await enterSearch(page);
    const ring = await field.evaluate((input) => {
      const whole = input.closest(".search-field");
      if (!whole) throw new Error("The input sits in its field");
      const style = getComputedStyle(whole);
      return {
        field: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.outlineOffset}`,
        input: getComputedStyle(input).outlineStyle,
      };
    });
    expect(ring, `at ${width ?? "a phone's"} width`).toEqual({
      field: `solid 2px ${INK} 2px`,
      input: "none",
    });
  }
});

test("on a phone, a tab's count is set in Caption, inside its 18px badge", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone has the tabs.");
  const { id } = await contextOfOwn(page, testInfo, "Badge");
  const { record } = await callContextTool(page, id, "record_entry", {
    words: "Errands",
    tasks: [{ title: "Pay the plumber" }],
  });
  await callContextTool(page, id, "set_task_dates", {
    id: record.tasks[0].id,
    due_date: "2020-01-06",
  });
  await page.goto("/");

  const badge = page
    .getByRole("navigation", { name: "Columns" })
    .getByRole("button", { name: /^Attention/ })
    .locator(".badge");
  await expect(badge).toBeVisible();
  const type = await badge.evaluate((span) => {
    const style = getComputedStyle(span);
    return `${style.fontWeight} ${style.fontSize}/${style.lineHeight}`;
  });
  expect(type).toBe("600 12px/16px");
  expect((await boxOf(badge)).height).toBeCloseTo(18, 0);
});
