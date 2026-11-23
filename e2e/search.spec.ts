import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { SearchHit } from "@praxis/domain";
import {
  callContextTool,
  callDeploymentTool,
  contextOfOwn,
  entryAction,
  expect,
  openJournal,
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

  const search = journal.getByRole("searchbox", { name: "Search this Context" });
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

  await search.fill(tag);
  await expect(hit).toHaveCount(1);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(hit).toHaveCount(0);

  // Sent to the Trash, it is found no more.
  await (await entryAction(entry, "Delete", testInfo)).click();
  await expect(entry).toHaveCount(0);
  await search.fill(tag);
  await expect(journal.getByText("Nothing found")).toBeVisible();
  await expect(hit).toHaveCount(0);
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

  const search = journal.getByRole("searchbox", { name: "Search this Context" });
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
  await journal.getByRole("searchbox", { name: "Search this Context" }).fill(tag);
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
  await call("record_entry", {
    words: "Chores",
    tasks: Array.from({ length: 51 }, (_, at) => ({ title: `Chore ${at + 1} ${tag}` })),
  });

  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  await journal.getByRole("searchbox", { name: "Search this Context" }).fill(tag);
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
});
