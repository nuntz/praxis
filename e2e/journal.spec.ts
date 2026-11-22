import {
  callContextTool,
  entryAction,
  expect,
  lastShown,
  makeContext,
  openJournal,
  test,
} from "./fixtures.ts";

test("the person records Entries in the Journal's composer and sees them in time order", async ({
  page,
}, testInfo) => {
  // Every run shares one Journal, in parallel and repeated, so each run's words are its own.
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const first = `Called the landlord ${tag}`;
  const second = `Lease renewal needs a signature ${tag}\n  indented, as typed`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);

  await composer.fill(first);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByRole("listitem").filter({ hasText: first })).toBeVisible();
  await expect(composer).toHaveValue("");

  await composer.fill(second);
  await composer.press("ControlOrMeta+Enter");
  await expect(journal.getByRole("listitem").filter({ hasText: tag })).toHaveCount(2);

  // What the server kept, read back afresh, oldest first: the words as typed, which the editor
  // shows as they are kept, though the Journal renders the second's lines as one paragraph.
  await page.reload();
  await openJournal(page, testInfo);
  const ours = journal.getByTestId("entry").filter({ hasText: tag });
  await expect(ours).toHaveCount(2);
  await expect(ours.nth(0).getByTestId("words")).toHaveText(first);
  await expect(ours.nth(1).getByTestId("words").locator("p")).toHaveCount(1);
  // Found by its id from here on, since editing it hides its words.
  const renewal = journal.locator(`[id="${await ours.nth(1).getAttribute("id")}"]`);
  await (await entryAction(renewal, "Edit", testInfo)).click();
  await expect(
    renewal.getByRole("textbox", { name: "The Entry's words", exact: true }),
  ).toHaveValue(second);
});

test("the person records an Entry with an Inline Task and finishes the Task where it is shown", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const title = `Send the signed lease ${tag}`;
  const words = `Called the landlord ${tag}\n[] ${title}\n- Not a Task ${tag}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill(words);
  await journal.getByRole("button", { name: "Record" }).click();

  // The marked line makes one Task, shown with its Entry; the list item makes none.
  const entry = journal.getByTestId("entry").filter({ hasText: `Called the landlord ${tag}` });
  await expect(entry.getByRole("checkbox")).toHaveCount(1);
  const task = entry.getByRole("checkbox", { name: title });
  await expect(task).not.toBeChecked();
  // The marked line is shown as typed, marker and all, and the list item as a list.
  const shown = entry.getByTestId("words");
  await expect(shown.getByText(`[] ${title}`, { exact: true })).toBeVisible();
  await expect(shown.getByRole("listitem")).toHaveText(`Not a Task ${tag}`);

  await task.check();
  await expect(task).toBeChecked();

  // What the server kept, read back afresh: the Task is Finished, and still hangs off its Entry.
  await page.reload();
  await openJournal(page, testInfo);
  await expect(entry.getByRole("checkbox", { name: title })).toBeChecked();
  await expect(shown.getByText(`[] ${title}`, { exact: true })).toBeVisible();
});

test("the person sees an Entry's words rendered as Markdown, and edits them as typed", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const title = `Ask the boathouse for a quote ${tag}`;
  const typedAsIs = "Not rendered: [old](http://example.com) ~~struck~~ <b>raw</b>";
  const words = [
    `## Offsite ${tag}`,
    "Finance closes **Friday**: [the wiki](https://wiki.example.com/finance) or https://forms.example.com/offsite",
    "",
    typedAsIs,
    "",
    "- The boathouse",
    "- The old print works",
    "",
    "| Venue | Holds | Per head | Travel from the office | Deposit | Notes |",
    "|---|--:|--:|---|--:|---|",
    "| The boathouse on the lake | 40 | 210 | Fifty minutes by coach from the office | 1,500 | No projector, so bring our own |",
    `[] ${title}`,
  ].join("\n");

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill(words);
  await journal.getByRole("button", { name: "Record" }).click();
  const recorded = journal.getByTestId("entry").filter({ hasText: `Offsite ${tag}` });
  await expect(recorded).toHaveCount(1);
  // Found by its id from here on, since editing it hides its words.
  const entry = journal.locator(`[id="${await recorded.getAttribute("id")}"]`);
  const shown = entry.getByTestId("words");

  await expect(shown.getByRole("heading", { name: `Offsite ${tag}`, exact: true })).toBeVisible();
  await expect(shown.locator("strong")).toHaveText("Friday");
  await expect(shown.getByRole("listitem")).toHaveText(["The boathouse", "The old print works"]);
  // Only an https address is a link, and a link opens in a new tab and sends no referrer.
  await expect(shown.getByRole("link")).toHaveCount(2);
  const wiki = shown.getByRole("link", { name: "the wiki", exact: true });
  await expect(wiki).toHaveAttribute("href", "https://wiki.example.com/finance");
  await expect(wiki).toHaveAttribute("target", "_blank");
  await expect(wiki).toHaveAttribute("rel", "noreferrer");
  await expect(
    shown.getByRole("link", { name: "https://forms.example.com/offsite", exact: true }),
  ).toHaveAttribute("href", "https://forms.example.com/offsite");
  await expect(shown.getByText(typedAsIs, { exact: true })).toBeVisible();
  // The Inline Task's line is shown as typed, and its Task with the Entry.
  await expect(shown.getByText(`[] ${title}`, { exact: true })).toBeVisible();
  await expect(entry.getByRole("checkbox", { name: title })).toBeVisible();

  // The table is wider than the column, and scrolls sideways inside the Entry, which does not.
  const table = shown.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(6);
  const widths = await shown.evaluate((words) => {
    const scrolled = words.querySelector(".table-scroll") as HTMLElement;
    return {
      table: [scrolled.scrollWidth, scrolled.clientWidth],
      words: [words.scrollWidth, words.clientWidth],
    };
  });
  expect(widths.table[0]).toBeGreaterThan(widths.table[1] as number);
  expect(widths.words[0]).toBe(widths.words[1]);

  // The editor shows the words as typed, with no preview.
  await (await entryAction(entry, "Edit", testInfo)).click();
  await expect(entry.getByRole("textbox", { name: "The Entry's words", exact: true })).toHaveValue(
    words,
  );
});

/** A one-pixel PNG, served for an image's address so no journey reaches beyond the Worker. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("an image loads by itself only in an Entry the person wrote by hand, and waits for a tap in any other", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${crypto.randomUUID()}`;
  const context = await makeContext(page, {
    name: `Images ${tag}`,
    time_zone: "UTC",
    accent: "rust",
  });
  await lastShown(page, context.id);
  // Every image's host is this stand-in, which counts what the browser asks it for. The content
  // security policy still applies: it is the browser's, ahead of the request.
  const asked: string[] = [];
  await page.route("https://images.example/**", (route) => {
    const address = route.request().url();
    asked.push(address);
    if (address.endsWith("/missing.png")) return route.abort();
    return route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);

  // The person's own Entry, written by hand: its images load by themselves, with no frame, and
  // one that fails says so, with its address as a link.
  await composer.fill(
    [
      `Venue ${tag}`,
      "",
      `![The boathouse ${tag}](https://images.example/boathouse.png)`,
      "",
      `![Seating chart ${tag}](https://images.example/missing.png)`,
    ].join("\n"),
  );
  await journal.getByRole("button", { name: "Record" }).click();
  const mine = journal.getByTestId("entry").filter({ hasText: `Venue ${tag}` });
  const boathouse = mine.getByRole("img", { name: `The boathouse ${tag}`, exact: true });
  await expect(boathouse).toBeVisible();
  await expect
    .poll(() => boathouse.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(boathouse).toHaveCSS("border-style", "none");
  const failed = mine.getByTestId("image-line");
  await expect(failed).toContainText(`Seating chart ${tag}`);
  await expect(failed).toContainText("did not load");
  await expect(
    failed.getByRole("link", { name: "images.example/missing.png", exact: true }),
  ).toHaveAttribute("href", "https://images.example/missing.png");

  // The Agent's Entry, recorded from the Conversation: its image waits for a tap, and nothing is
  // asked of its address until then.
  const floorPlan = "https://images.example/floor-plan.png";
  await callContextTool(page, context.id, "send_message", {
    words: `Record: Floor ${tag}\n\n![Floor plan ${tag}](${floorPlan})`,
  });
  const recorded = journal.getByTestId("entry").filter({ hasText: `Floor ${tag}` });
  await expect(recorded).toHaveCount(1);
  // Found by its id from here on, since editing it hides its words.
  const agents = journal.locator(`[id="${await recorded.getAttribute("id")}"]`);
  const show = agents.getByRole("button", { name: `Show image Floor plan ${tag}`, exact: true });
  await expect(show).toBeVisible();
  await expect(agents.getByRole("img")).toHaveCount(0);
  expect(asked).not.toContain(floorPlan);

  // A tap loads it for this showing only.
  await show.click();
  await expect(agents.getByRole("img", { name: `Floor plan ${tag}`, exact: true })).toBeVisible();
  await expect.poll(() => asked).toContain(floorPlan);
  await page.reload();
  await openJournal(page, testInfo);
  await expect(show).toBeVisible();
  await expect(agents.getByRole("img")).toHaveCount(0);

  // The person's edit makes the Entry theirs, and its image then loads by itself.
  await (await entryAction(agents, "Edit", testInfo)).click();
  const editor = agents.getByRole("textbox", { name: "The Entry's words", exact: true });
  await editor.fill(`Floor ${tag}, checked\n\n![Floor plan ${tag}](${floorPlan})`);
  await agents.getByRole("button", { name: "Save", exact: true }).click();
  await expect(agents.getByRole("img", { name: `Floor plan ${tag}`, exact: true })).toBeVisible();
  await expect(show).toHaveCount(0);
});
