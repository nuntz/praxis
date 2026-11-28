import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { SearchHit } from "@praxis/domain";
import {
  callContextTool,
  callDeploymentTool,
  contextOfOwn,
  enterSearch,
  entryAction,
  expect,
  openJournal,
  showTab,
  test,
} from "./fixtures.ts";

test("the person searches the Journal, sees the excerpt as typed, opens the Entry and no longer finds it once deleted", async ({
  page,
}, testInfo) => {
  // Every run shares one Journal, in parallel and repeated, so each run's words are its own.
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const words = `Asked about the **storage unit** ${tag}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  await composer.fill(words);
  await journal.getByRole("button", { name: "Record" }).click();
  const entry = journal.getByTestId("entry").filter({ hasText: tag });
  await expect(entry).toBeVisible();

  const search = await enterSearch(page);
  await search.fill(`storage ${tag}`);
  const hit = journal.getByTestId("search-hit");
  await expect(hit).toHaveCount(1);
  // The excerpt is the words as typed, never rendered as Markdown, with what matched marked.
  await expect(hit.getByTestId("search-excerpt")).toHaveText(words);
  await expect(hit.locator("mark")).toHaveText(["storage", tag]);
  await expect(hit.locator("strong")).toHaveCount(0);
  await expect(entry).toBeHidden();

  // Opening it ends the search and brings the Entry into view in the Journal.
  await hit.getByRole("link").click();
  await expect(search).toHaveValue("");
  await expect(entry).toBeFocused();

  await enterSearch(page);
  await search.fill(tag);
  await expect(hit).toHaveCount(1);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(hit).toHaveCount(0);

  // Sent to the Trash, it is found no more.
  await (await entryAction(entry, "Delete", testInfo)).click();
  await expect(entry).toHaveCount(0);
  await enterSearch(page);
  await search.fill(tag);
  await expect(journal.getByText("Nothing found")).toBeVisible();
  await expect(hit).toHaveCount(0);
});

/** Two frames on, by when the column has heard of every change of size the Entries shown made. */
function nextFrames(): Promise<void> {
  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
}

test("an Entry or a Task opened from search, older than the screen holds, is brought into view with the focus on it", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const context = await contextOfOwn(page, testInfo, "Found older");
  const call = (tool: string, input: unknown) => callContextTool(page, context.id, tool, input);
  const older = `The shed's hinge squeaks ${tag}`;
  const title = `Oil the hinge ${tag}`;
  await call("record_entry", { words: older, tasks: [{ title }] });
  // Enough newer Entries that the older one sits well above what the column shows.
  for (let at = 0; at < 16; at += 1) {
    await call("record_entry", {
      words: `Later note ${at}, a few lines long so that each one takes room in the column.\n\nA second paragraph.\n\nAnd a third.`,
    });
  }

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const entry = journal.getByTestId("entry").filter({ hasText: older });
  const hit = journal.getByTestId("search-hit");

  const search = await enterSearch(page);
  await search.fill(`squeaks ${tag}`);
  await expect(hit).toHaveCount(1);
  await hit.getByRole("link").click();
  await expect(search).toHaveValue("");
  await expect(entry).toBeFocused();
  await expect(entry).toBeInViewport();
  // Still in view once the column has heard the Entries shown again, its hold on its newest let go.
  await page.evaluate(nextFrames);
  await expect(entry).toBeInViewport();

  // Scrolled back to the newest, the column holds it again: an Entry arriving comes into view.
  await journal.getByTestId("entry").last().scrollIntoViewIfNeeded();
  await expect(entry).not.toBeInViewport();
  const newest = `Arrived after ${tag}`;
  await call("record_entry", { words: newest });
  await expect(journal.getByTestId("entry").filter({ hasText: newest })).toBeInViewport();

  // A Task found opens on its Entry, in view too, pressed by the keyboard.
  await enterSearch(page);
  await search.fill(`Oil ${tag}`);
  const task = entry
    .getByRole("list", { name: "Tasks" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("checkbox", { name: title }) });
  const link = hit.getByRole("link", { name: new RegExp(`^Task, ${title} `) });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("");
  await expect(task).toBeFocused();
  await expect(task).toBeInViewport();
  await page.evaluate(nextFrames);
  await expect(task).toBeInViewport();
});

test("the person finds an Entry by what it means, though it shares no word with the search", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;

  await page.goto("/");
  const { journal, composer } = await openJournal(page, testInfo);
  // The journeys' meaning index says a molar and a dentist mean alike (journey-worker.ts).
  await composer.fill(`The molar aches again ${tag}`);
  await journal.getByRole("button", { name: "Record" }).click();
  await expect(journal.getByTestId("entry").filter({ hasText: tag })).toBeVisible();

  const search = await enterSearch(page);
  // Other runs' Entries are found too, so this one is picked out by its tag.
  const hit = journal.getByTestId("search-hit").filter({ hasText: tag });
  // Found by meaning shortly after it is saved, not at once: each try asks afresh.
  await expect(async () => {
    await search.fill("");
    await search.fill("dentist");
    await expect(hit).toHaveCount(1, { timeout: 1000 });
  }).toPass();
  // Nothing in it matched the words, so nothing is marked.
  await expect(hit.locator("mark")).toHaveCount(0);
});

test("an Entry found only by meaning is set apart under Close in meaning, folded while another holds the words and open when none does", async ({
  page,
}, testInfo) => {
  const context = await contextOfOwn(page, testInfo, "Close");
  const call = (tool: string, input: unknown) => callContextTool(page, context.id, tool, input);
  // The journeys' meaning index says a lantern, a lamp, a torch and a beacon mean alike
  // (journey-worker.ts).
  await call("record_entry", { words: "Bought a lantern for the shed" });
  await call("record_entry", { words: "The lamp flickers at night" });
  await call("record_entry", { words: "Packed a torch and spare batteries" });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const search = await enterSearch(page);
  const found = journal.getByRole("region", { name: "Found" });
  const headings = found.getByRole("heading");
  const entries = found.getByRole("region", { name: /^Entries / });
  const close = found.getByRole("region", { name: /^Close in meaning / });
  // Found by meaning shortly after they are saved, not at once: each try asks afresh.
  await expect(async () => {
    await search.fill("");
    await search.fill("lantern");
    await expect(headings).toHaveText(["Entries 1", "Close in meaning 2"], { timeout: 1000 });
  }).toPass();

  // The Entry that holds the word is found by its meaning too, and is listed once, with the words.
  await expect(entries.getByTestId("search-excerpt")).toHaveText(["Bought a lantern for the shed"]);
  await expect(close).toContainText("These hold none of the words, but are about something close.");
  // Something holds the words, so what meaning alone found is folded.
  const fold = close.getByRole("button", { name: "Show 2 Entries" });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(close.getByRole("listitem")).toHaveCount(0);
  // What it controls is there, hidden, while it is folded.
  const folded = page.locator(`#${await fold.getAttribute("aria-controls")}`);
  await expect(folded).toHaveCount(1);
  await expect(folded).toBeHidden();

  // One tap unfolds it, the hits in the tool's order, nothing in them marked.
  await fold.click();
  await expect(close.getByRole("button", { name: "Hide 2 Entries" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const { items } = await call("search", { words: "lantern" });
  await expect(close.getByTestId("search-excerpt")).toHaveText(
    (items as SearchHit[])
      .filter((hit) => hit.excerpt.matches.length === 0)
      .map((hit) => hit.excerpt.text),
  );
  await expect(close.locator("mark")).toHaveCount(0);
  await expect(found.getByTestId("search-hit")).toHaveCount(3);
  await expect(folded).toBeVisible();

  // New words fold it again.
  await search.fill("lamp");
  await expect(entries.getByTestId("search-excerpt")).toHaveText(["The lamp flickers at night"]);
  await expect(close.getByRole("button", { name: "Show 2 Entries" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Nothing holds these words, so what meaning found is shown open, with no fold.
  await search.fill("beacon");
  await expect(headings).toHaveText(["Close in meaning 3"]);
  await expect(close).toContainText("These hold none of the words, but are about something close.");
  await expect(close.getByRole("button")).toHaveCount(0);
  await expect(close.getByTestId("search-hit")).toHaveCount(3);
});

/** The kinds a search finds, each with its group's heading, in the order the screen shows them. */
const GROUPS = [
  ["project", "Projects"],
  ["person", "Persons"],
  ["task", "Tasks"],
  ["entry", "Entries"],
] as const;

/** An outside agent with a Connection's address pasted into it, signed in as the person. */
async function connectTo(address: string): Promise<Client> {
  const client = new Client(
    { name: "a browser journey", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(address)));
  return client;
}

/** A time of day as the Device's locale writes it, en-US in the journeys. */
const TIME = /\d{1,2}:\d{2}\s[AP]M/.source;

test("what a search finds is grouped by kind in a fixed order, what matched is marked, and each hit says when and by whom", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const context = await contextOfOwn(page, testInfo, "Found");
  const call = (tool: string, input: unknown) => callContextTool(page, context.id, tool, input);
  const garden = (await call("create_project", { name: `Garden ${tag}` })).record;
  await call("create_person", { name: `Alice ${tag}` });
  await call("record_entry", { words: "Errands", tasks: [{ title: `Ring the roofer ${tag}` }] });
  await call("record_entry", {
    words: `The roof leaked ${tag}`,
    made_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  });
  await call("record_entry", { words: `Back then ${tag}`, made_at: "2024-03-05T15:30:00Z" });
  const outside = `Roofer's agent ${crypto.randomUUID().slice(0, 8)}`;
  const { record: connection } = await callDeploymentTool(page, "create_connection", {
    name: outside,
    context_id: context.id,
    reading_only: false,
  });

  await page.goto("/");
  const client = await connectTo(new URL(connection.address, page.url()).href);
  await client.callTool({ name: "record_entry", arguments: { words: `Quoted for ${tag}` } });
  const { journal } = await openJournal(page, testInfo);
  await (await enterSearch(page)).fill(tag);
  const found = journal.getByRole("region", { name: "Found" });
  const headings = found.getByRole("heading");
  await expect(headings).toHaveText(["Projects 1", "Persons 1", "Tasks 1", "Entries 3"]);

  // Within its group, each hit keeps the place the tool gave it.
  const { items } = await call("search", { words: tag });
  for (const [kind, title] of GROUPS) {
    const group = found.getByRole("region", { name: new RegExp(`^${title} `) });
    await expect(group.getByTestId("search-excerpt")).toHaveText(
      (items as SearchHit[]).filter((hit) => hit.kind === kind).map((hit) => hit.excerpt.text),
    );
  }

  // What matched is marked on the match token, in ink at 600: in a title as in an Entry's words.
  const marks = found.locator("mark");
  await expect(marks).toHaveText(Array(6).fill(tag));
  await expect(marks.first()).toHaveCSS("background-color", "rgb(255, 229, 138)");
  await expect(marks.first()).toHaveCSS("font-weight", "600");

  // A hit says when it was made as the Journal's days do, in the Context's zone, with a year only
  // for an earlier year, then its Author when that is not the person.
  const entry = (words: string) =>
    found.getByRole("region", { name: /^Entries / }).getByRole("link", { name: new RegExp(words) });
  await expect(entry("The roof leaked")).toHaveAccessibleName(
    new RegExp(`^Entry, Yesterday · ${TIME} The roof leaked ${tag}$`),
  );
  await expect(entry("Back then")).toHaveAccessibleName(
    `Entry, Tue, Mar 5, 2024 · 3:30 PM Back then ${tag}`,
  );
  await expect(entry("Quoted for")).toHaveAccessibleName(
    new RegExp(`^Entry, Today · ${TIME} · ${outside} Quoted for ${tag}$`),
  );
  await expect(
    found.getByRole("region", { name: /^Tasks / }).getByRole("link"),
  ).toHaveAccessibleName(new RegExp(`^Task, Ring the roofer ${tag} Today · ${TIME}$`));
  // A Project found shows no time, as the board draws it, but is named by it all the same.
  const project = found.getByRole("region", { name: /^Projects / }).getByRole("button");
  await expect(project).toHaveAccessibleName(
    new RegExp(
      `^Project, Garden ${tag} Today · ${TIME} · Open · 0 actionable · Needs a next Task or finishing$`,
    ),
  );

  // What is found follows what changes: a Project renamed away from the words leaves, and its
  // heading with it, since a kind with nothing found has none.
  await call("rename_project", { id: garden.id, name: "Orchard" });
  await expect(headings).toHaveText(["Persons 1", "Tasks 1", "Entries 3"]);
});

test("one Show more found ends the list, and what it brings joins its kind's group", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const context = await contextOfOwn(page, testInfo, "Paged");
  const call = (tool: string, input: unknown) => callContextTool(page, context.id, tool, input);
  // Fifty-one Tasks and a Project: more than a page's fifty, so whichever place the Project takes,
  // a Task is on the next page.
  await call("create_project", { name: `Shed ${tag}` });
  const { record: chores } = await call("record_entry", {
    words: "Chores",
    tasks: Array.from({ length: 51 }, (_, at) => ({ title: `Chore ${at + 1} ${tag}` })),
  });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  await (await enterSearch(page)).fill(tag);
  const found = journal.getByRole("region", { name: "Found" });
  const hits = found.getByTestId("search-hit");
  await expect(hits).toHaveCount(50);
  const more = found.getByRole("button", { name: "Show more found" });
  // One button, after every group.
  await expect(found.locator("section:last-of-type ~ button")).toHaveText(["Show more found"]);

  await more.click();
  await expect(hits).toHaveCount(52);
  await expect(found.getByRole("heading")).toHaveText(["Projects 1", "Tasks 51"]);
  await expect(more).toHaveCount(0);

  // A Task finished from the page Show more brought keeps that page shown: the list follows the
  // change where it stands, and never goes back to its first page. The last Task in the tool's
  // order is on the second page, wherever the Project fell.
  const tasks = found.getByRole("region", { name: /^Tasks / });
  const chore = await tasks.getByTestId("search-excerpt").last().textContent();
  if (!chore) throw new Error("The last Task found has a title");
  const task = (chores.tasks as { id: string; title: string }[]).find((t) => t.title === chore);
  if (!task) throw new Error("The last Task found is one of the Chores");
  await found.getByRole("button", { name: `Finish “${chore}”`, exact: true }).click();
  await expect(found.getByRole("button", { name: `Reopen “${chore}”`, exact: true })).toBeVisible();
  // A change from elsewhere, brought by the live channel after the finish's own: once it shows,
  // the finish's has been followed too.
  await call("rename_task", { id: task.id, title: `${chore} again` });
  await expect(
    found.getByRole("button", { name: `Reopen “${chore} again”`, exact: true }),
  ).toBeVisible();
  await expect(hits).toHaveCount(52);
});

test("a Task found says where it stands as Attention does, is finished and reopened from its round control, and opens from its title", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "")}`;
  const context = await contextOfOwn(page, testInfo, "Standing");
  const call = (tool: string, input: unknown) => callContextTool(page, context.id, tool, input);
  const titles = {
    open: `Post the parcel ${tag}`,
    finished: `Paid the deposit ${tag}`,
    recurring: `Weekly review ${tag}`,
    waiting: `Waiting for the quote ${tag}`,
    delegated: `Mow the lawn ${tag}`,
    deferred: `Book the dentist ${tag}`,
    overdue: `Renew the passport ${tag}`,
    dropped: `Old plan ${tag}`,
  };
  const { record: entry } = await call("record_entry", {
    words: "Errands",
    tasks: Object.values(titles).map((title) => ({ title })),
  });
  const [open, finished, recurring, waiting, delegated, deferred, overdue, dropped] = (
    entry.tasks as { id: string }[]
  ).map(({ id }) => id);
  const alice = (await call("create_person", { name: "Alice Moreau" })).record;
  await call("finish_task", { id: finished });
  await call("set_task_dates", { id: recurring, due_date: "2099-01-05" });
  await call("set_recurrence", {
    id: recurring,
    recurrence: { kind: "weeks", every: 1, on: ["monday"] },
  });
  await call("wait_on", { id: waiting, on: { kind: "task", id: open } });
  await call("delegate_task", { id: delegated, person_id: alice.id });
  await call("set_task_dates", { id: deferred, defer_date: "2099-01-10" });
  await call("set_task_dates", { id: overdue, due_date: "2025-01-10" });
  await call("drop_task", { id: dropped });
  const kitchen = (await call("create_project", { name: `Kitchen ${tag}` })).record;
  await call("move_task", { id: open, project_id: kitchen.id });
  const shed = (await call("create_project", { name: `Shed ${tag}` })).record;
  await call("finish_project", { id: shed.id });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const search = await enterSearch(page);
  await search.fill(tag);
  const found = journal.getByRole("region", { name: "Found" });
  const tasks = found.getByRole("region", { name: /^Tasks / });
  const link = (title: string) => tasks.getByRole("link", { name: new RegExp(`^Task, ${title} `) });
  const made = `Today · ${TIME}`;

  // Each state that holds is a mark after its time, as Attention marks it.
  await expect(link(titles.open)).toHaveAccessibleName(
    new RegExp(`^Task, ${titles.open} ${made}$`),
  );
  for (const [title, marks] of [
    [titles.finished, "Finished"],
    [titles.recurring, "Due Jan 5, 2099 · Recurring"],
    [titles.waiting, `Waiting on ${titles.open}`],
    [titles.delegated, "Delegated to Alice Moreau since \\w+ \\d+, \\d{4}"],
    [titles.deferred, "Deferred until Jan 10, 2099"],
    [titles.overdue, "Due Jan 10, 2025, Overdue"],
    [titles.dropped, "Dropped"],
  ] as const) {
    await expect(link(title)).toHaveAccessibleName(
      new RegExp(`^Task, ${title} ${made} · ${marks}$`),
    );
  }
  // A finished one is muted and struck through; one open is neither.
  const title = (of: string) => link(of).getByTestId("search-excerpt");
  await expect(title(titles.finished)).toHaveCSS("text-decoration-line", "line-through");
  await expect(title(titles.open)).toHaveCSS("text-decoration-line", "none");

  // A Project found says where it stands, and while open its count of actionable Tasks.
  const projects = found.getByRole("region", { name: /^Projects / }).getByTestId("search-hit");
  const kitchenHit = projects.filter({ hasText: "Kitchen" });
  await expect(kitchenHit).toContainText("Open");
  await expect(kitchenHit).toContainText("1 actionable");
  await expect(kitchenHit).not.toContainText("Needs a next Task or finishing");
  const shedHit = projects.filter({ hasText: "Shed" });
  await expect(shedHit).toContainText("Finished");
  await expect(shedHit).not.toContainText("actionable");

  // Its round control finishes it, and the Task waiting on it is released.
  const finish = found.getByRole("button", { name: `Finish “${titles.open}”`, exact: true });
  const reopen = found.getByRole("button", { name: `Reopen “${titles.open}”`, exact: true });
  await finish.click();
  await expect(reopen).toBeFocused();
  await expect(link(titles.open)).toHaveAccessibleName(
    new RegExp(`^Task, ${titles.open} ${made} · Finished$`),
  );
  await expect(title(titles.open)).toHaveCSS("text-decoration-line", "line-through");
  await expect(link(titles.waiting)).toHaveAccessibleName(
    new RegExp(`^Task, ${titles.waiting} ${made}$`),
  );
  await expect(kitchenHit).toContainText("0 actionable");
  await expect(kitchenHit).toContainText("Needs a next Task or finishing");
  // Attention shows the released Task as newly actionable.
  await showTab(page, testInfo, "Attention");
  const attention = page.getByRole("region", { name: "Attention", exact: true });
  await expect(
    attention.getByRole("region", { name: "Newly actionable", exact: true }),
  ).toContainText(titles.waiting);
  await showTab(page, testInfo, "Journal");

  // On a finished one it reopens it.
  await reopen.click();
  await expect(finish).toBeFocused();
  await expect(link(titles.open)).toHaveAccessibleName(
    new RegExp(`^Task, ${titles.open} ${made}$`),
  );
  expect((await call("get_task", { id: open })).state.is).toBe("open");

  // Its title opens it in the Journal, and finishes nothing.
  await link(titles.open).click();
  await expect(search).toHaveValue("");
  await expect(journal.getByRole("checkbox", { name: titles.open, exact: true })).not.toBeChecked();
  expect((await call("get_task", { id: open })).state.is).toBe("open");
});
