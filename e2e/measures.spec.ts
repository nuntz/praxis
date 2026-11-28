import type { Locator } from "@playwright/test";
import {
  callContextTool,
  contextOfOwn,
  enterSearch,
  entryAction,
  expect,
  lastShown,
  makeContext,
  onPhone,
  openJournal,
  test,
} from "./fixtures.ts";

// Rules of DESIGN.md held by measuring the screen as rendered: the 44px Rule and the Round Controls
// Rule in the phone's top bar and Attention, the focus outline on the search field, the type
// scale on a tab's badge, the Tracking Rule, the hairlines asked for with more contrast, the
// 16px a field under a finger takes so the page never zooms, Attention's rows, their marks, their
// grounds and what a page draws in which colour, and an Entry's hairline, corners, head and
// toolbar (#186).

/** Ink, the focus outline's colour, in light. */
const INK = "rgb(26, 29, 35)";
/** Muted, in light: a hairline's colour when the Device asks for more contrast. */
const MUTED = "rgb(89, 96, 112)";
/** Rule, in light: a hairline's colour otherwise. */
const RULE = "rgb(213, 217, 224)";
/** Ground, in light: the page behind the panels, and a hovered row's step off `inset`. */
const GROUND = "rgb(236, 238, 242)";
/** Surface, in light: a panel, and an Attention row on a phone. */
const SURFACE = "rgb(255, 255, 255)";
/** Inset, in light: what sits inside a panel. */
const INSET = "rgb(244, 245, 248)";

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
    return `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.letterSpacing}`;
  });
  // Caption is opened up 0.01em, as small type is by the Tracking Rule.
  expect(type).toBe("600 12px/16px 0.12px");
  expect((await boxOf(badge)).height).toBeCloseTo(18, 0);
});

test("in between, Attention's edge over the Journal is a rule hairline, and muted when the Device asks for more contrast", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "Only in between does Attention open over the Journal.");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^Attention/ }).click();
  const attention = page.locator("#attention");
  await expect(attention).toBeVisible();
  const edge = () => attention.evaluate((panel) => getComputedStyle(panel).borderLeftColor);

  expect(await edge()).toBe(RULE);
  await page.emulateMedia({ colorScheme: "light", contrast: "more" });
  expect(await edge()).toBe(MUTED);
});

test("on a phone, the search's Project picker and the Move to choice are 16px, so neither zooms the page", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone's touch screen is a coarse pointer.");
  const { id, name } = await contextOfOwn(page, testInfo, "Fields");
  await makeContext(page, { name: `${name} elsewhere`, time_zone: "UTC", accent: "plum" });
  const words = `Fix the gate ${crypto.randomUUID().slice(0, 8)}`;
  await callContextTool(page, id, "record_entry", { words });
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const fontSize = (field: Locator) => field.evaluate((shown) => getComputedStyle(shown).fontSize);

  const entry = journal.getByTestId("entry").filter({ hasText: words }).first();
  await (await entryAction(entry, "Move", testInfo)).click();
  const moveTo = entry.getByRole("combobox", { name: "Move to" });
  await expect(moveTo).toBeVisible();
  expect(await fontSize(moveTo)).toBe("16px");
  await entry.getByRole("button", { name: "Keep it here" }).click();

  await enterSearch(page);
  await journal
    .getByRole("group", { name: "Narrow the search" })
    .getByRole("button", { name: "Project", exact: true })
    .click();
  const finder = journal.getByRole("combobox", { name: "Find a Project" });
  await expect(finder).toBeFocused();
  expect(await fontSize(finder)).toBe("16px");
});

test("a row's mark in Attention takes at most 40% of the row, a Person's name is cut before the title is, and Overdue is never cut", async ({
  page,
}, testInfo) => {
  const { id } = await contextOfOwn(page, testInfo, "Marks");
  const [figures, ladder, notes] = [
    "Send the quarterly figures",
    "Return the borrowed ladder",
    "Write up the notes from Tuesday's long planning meeting with the whole team",
  ];
  const { record } = await callContextTool(page, id, "record_entry", {
    words: "Errands",
    tasks: [figures, ladder, notes].map((title) => ({ title })),
  });
  const [toMaya, toLong, late] = record.tasks as { id: string }[];
  const { record: maya } = await callContextTool(page, id, "create_person", {
    name: "Maya Okafor",
  });
  const { record: long } = await callContextTool(page, id, "create_person", {
    name: "Maya Okafor-Lindqvist de la Fontaine",
  });
  await callContextTool(page, id, "delegate_task", { id: toMaya?.id, person_id: maya.id });
  await callContextTool(page, id, "delegate_task", { id: toLong?.id, person_id: long.id });
  await callContextTool(page, id, "set_task_dates", { id: late?.id, due_date: "2020-01-06" });
  await page.goto("/");

  const attention = page.getByRole("region", { name: "Attention", exact: true });
  /** A row's width, its title's and its mark's, and whether each shows all it holds. */
  const measured = async (title: string) => {
    const open = attention.getByRole("button", { name: title, exact: true });
    await expect(open).toBeVisible();
    return open.evaluate((button) => {
      const row = button.closest("li");
      const shown = button.querySelector<HTMLElement>(".task-title");
      const lead = button.querySelector<HTMLElement>(".attention-row-lead");
      if (!row || !shown || !lead) throw new Error("The row has its title and its mark");
      return {
        row: row.getBoundingClientRect().width,
        lead: lead.getBoundingClientRect().width,
        leadText: lead.textContent,
        leadCut: lead.scrollWidth > lead.clientWidth,
        leadEnds: getComputedStyle(lead).textOverflow,
        titleCut: shown.scrollHeight > shown.clientHeight + 1,
      };
    });
  };

  // The title is whole in its two lines, and the Person and the day at most 40% beside it.
  const toMayaRow = await measured(figures);
  expect(toMayaRow.titleCut).toBe(false);
  expect(toMayaRow.lead).toBeLessThanOrEqual(toMayaRow.row * 0.4 + 1);

  // A name too long for its 40% is cut with an ellipsis, never shortened to part of it.
  const toLongRow = await measured(ladder);
  expect(toLongRow.titleCut).toBe(false);
  expect(toLongRow.lead).toBeLessThanOrEqual(toLongRow.row * 0.4 + 1);
  expect(toLongRow.leadText).toMatch(/^Maya Okafor-Lindqvist de la Fontaine, \S/);
  expect(toLongRow.leadCut).toBe(true);
  expect(toLongRow.leadEnds).toBe("ellipsis");

  // Overdue is never cut, however long the title beside it.
  const lateRow = await measured(notes);
  expect(lateRow.leadText).toMatch(/2020, Overdue$/);
  expect(lateRow.leadCut).toBe(false);
});

test("Delete on a Task's and a Project's page is in ink, as Drop is, and an empty date field's placeholder is muted", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  const { id } = await contextOfOwn(page, testInfo, "Inks");
  const title = "Oil the hinges";
  await callContextTool(page, id, "record_entry", { words: "Errands", tasks: [{ title }] });
  await callContextTool(page, id, "create_project", { name: "Workshop" });
  await page.goto("/");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  const color = (locator: Locator) => locator.evaluate((shown) => getComputedStyle(shown).color);

  await attention.getByRole("button", { name: title, exact: true }).click();
  const task = attention.getByRole("dialog", { name: title });
  const deleteTask = task.getByRole("button", { name: /^Delete/ });
  await expect(deleteTask).toBeVisible();
  expect(await color(deleteTask)).toBe(INK);
  expect(await color(task.getByRole("button", { name: /^Drop/ }))).toBe(INK);
  // With no day in it, the field shows only its placeholder, in muted; taken to type in, ink.
  const due = task.getByLabel("Due Date", { exact: true });
  await expect(due).toHaveValue("");
  expect(await color(due)).toBe(MUTED);
  await due.focus();
  expect(await color(due)).toBe(INK);
  await task.getByRole("button", { name: /^Back/ }).click();

  await attention.getByRole("button", { name: "Workshop", exact: true }).click();
  const project = attention.getByRole("dialog", { name: "Workshop" });
  const deleteProject = project.getByRole("button", { name: /^Delete/ });
  await expect(deleteProject).toBeVisible();
  expect(await color(deleteProject)).toBe(INK);
});

test("on a phone, Attention's rows sit on surface, a step off the ground", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone shows Attention on the ground itself.");
  await page.emulateMedia({ colorScheme: "light" });
  const { id } = await contextOfOwn(page, testInfo, "Grounds");
  const title = "Sweep the porch";
  await callContextTool(page, id, "record_entry", { words: "Errands", tasks: [{ title }] });
  await page.goto("/");
  const row = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("listitem")
    .filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS("background-color", SURFACE);
});

test("a row that opens a page takes a tone step while hovered, and its chevron turns ink", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "A phone's touch screen hovers nothing.");
  await page.emulateMedia({ colorScheme: "light" });
  const { id } = await contextOfOwn(page, testInfo, "Hovers");
  const title = "Wind the clock";
  await callContextTool(page, id, "record_entry", { words: "Errands", tasks: [{ title }] });
  await page.goto("/");
  const row = page
    .getByRole("region", { name: "Attention", exact: true })
    .getByRole("listitem")
    .filter({ hasText: title });
  const open = row.getByRole("button", { name: title, exact: true });
  const chevron = open.locator(".attention-row-chevron");
  await expect(row).toHaveCSS("background-color", INSET);
  await expect(chevron).toHaveCSS("color", MUTED);

  await open.hover();
  await expect(row).toHaveCSS("background-color", GROUND);
  await expect(chevron).toHaveCSS("color", INK);
  // Over its round control, which finishes it, the row opens nothing, so it takes no step.
  await row.getByRole("checkbox", { name: title, exact: true }).hover();
  await expect(row).toHaveCSS("background-color", INSET);
});

test("on a phone, a standing Notice's link is a 44px target, its text where it was", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a phone holds a touch target to 44px.");
  // The shared Deployment has no such Notice for real, so the screen is told of one.
  await page.route(/\/list_notices$/, async (route) => {
    const answer = await route.fetch();
    await route.fulfill({
      response: answer,
      json: { ok: true, value: { items: [{ kind: "no_backup", last_made: null }] } },
    });
  });
  await page.goto("/");
  const card = page.getByTestId("standing-notice");
  const link = card.getByRole("link", { name: "See Backups and Export" });
  await expect(link).toBeVisible();

  const target = await boxOf(link);
  console.log(
    "PLACED",
    await link.evaluate((shown) => {
      const r = document.createRange();
      r.selectNodeContents(shown.firstChild as Node);
      const l = r.getBoundingClientRect();
      const w = shown.parentElement
        ?.querySelector(".standing-notice-words")
        ?.getBoundingClientRect();
      const c = shown.closest(".standing-notice")?.getBoundingClientRect();
      return [l.top - (w?.bottom ?? 0), (c?.bottom ?? 0) - l.bottom];
    }),
  );
  expect(target.height).toBeGreaterThanOrEqual(44);
  // Its text stays where it was: 8px under the Notice's words, as the card's gap and the link's
  // margin set its line, and 12px of the card under that line. The text's own box sits 2px inside
  // its 23px line, so the target grows round it and moves nothing.
  const placed = await link.evaluate((shown) => {
    const words = shown.parentElement?.querySelector(".standing-notice-words");
    const text = shown.firstChild;
    const whole = shown.closest(".standing-notice");
    if (!words || !text || !whole) throw new Error("The Notice has its words and its link");
    const range = document.createRange();
    range.selectNodeContents(text);
    const line = range.getBoundingClientRect();
    return {
      under: line.top - words.getBoundingClientRect().bottom,
      above: whole.getBoundingClientRect().bottom - line.bottom,
    };
  });
  expect(placed.under).toBeCloseTo(10, 0);
  expect(placed.above).toBeCloseTo(14, 0);
});

test("on a desktop, an Entry at rest is parted by a square-ended hairline, rounds only while hovered, and its toolbar's buttons are 36px", async ({
  page,
}, testInfo) => {
  test.skip(onPhone(testInfo), "Only a pointer that hovers has the hairlines and the toolbar.");
  const { id } = await contextOfOwn(page, testInfo, "Hairlines");
  await callContextTool(page, id, "record_entry", { words: "Swept the porch" });
  await callContextTool(page, id, "record_entry", { words: "Wound the clock" });
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const entry = journal.getByTestId("entry").filter({ hasText: "Wound the clock" });
  await expect(entry).toBeVisible();
  await page.mouse.move(0, 0);

  await expect(entry).toHaveCSS("border-top-style", "solid");
  await expect(entry).toHaveCSS("border-top-left-radius", "0px");
  await expect(entry).toHaveCSS("border-top-right-radius", "0px");
  await entry.hover();
  await expect(entry).toHaveCSS("border-top-left-radius", "14px");
  // Given the focus, as Restore gives it, with the pointer away, it rounds too.
  await page.mouse.move(0, 0);
  await expect(entry).toHaveCSS("border-top-left-radius", "0px");
  await entry.focus();
  await expect(entry).toHaveCSS("border-top-left-radius", "14px");

  // A row's own icon button on a desktop is 36px (the 44px Rule), More among them.
  const buttons = entry
    .getByRole("toolbar", { name: "Entry actions", exact: true })
    .getByRole("button");
  await expect(buttons).toHaveCount(5);
  for (const button of await buttons.all()) {
    const box = await boxOf(button);
    expect(box.width).toBeCloseTo(36, 0);
    expect(box.height).toBeCloseTo(36, 0);
  }
});

test("on a phone, an Entry's time and its one button sit on one line, centre to centre", async ({
  page,
}, testInfo) => {
  test.skip(!onPhone(testInfo), "Only a touch screen has the one button beside the time.");
  const { id } = await contextOfOwn(page, testInfo, "Heads");
  await callContextTool(page, id, "record_entry", { words: "Oiled the gate" });
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const entry = journal.getByTestId("entry").filter({ hasText: "Oiled the gate" });
  const time = entry.locator("time");
  const button = entry.getByRole("button", { name: "Actions for this Entry", exact: true });
  await expect(button).toBeVisible();

  const [said, pressed] = [await boxOf(time), await boxOf(button)];
  expect(said.y + said.height / 2).toBeCloseTo(pressed.y + pressed.height / 2, 0);
  await expect(entry).toHaveCSS("border-top-left-radius", "14px");
});

test("inline code in an Entry's words takes the small radius of the scale", async ({
  page,
}, testInfo) => {
  const { id } = await contextOfOwn(page, testInfo, "Code");
  await callContextTool(page, id, "record_entry", { words: "Ran `make clean` twice" });
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const code = journal.getByTestId("entry").getByRole("code");
  await expect(code).toBeVisible();
  await expect(code).toHaveCSS("border-top-left-radius", "10px");
});
