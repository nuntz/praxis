import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Page, TestInfo } from "@playwright/test";
import {
  callContextTool,
  callDeploymentTool,
  contextOfOwn,
  enterSearch,
  expect,
  openJournal,
  test,
} from "./fixtures.ts";

// The Author chip narrows search to an Author, with words or without (section 8.4): you, the
// Agent, any Connection, or a Connection of the Context by name, an ended one too, since its name
// stays on what it made (section 7.2). With no words, it lists everything by that Author, newest
// first.

/** An outside agent with a Connection's address pasted into it, signed in as the person. */
async function connectTo(address: string): Promise<Client> {
  const client = new Client(
    { name: "a browser journey", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(address)));
  return client;
}

/**
 * A Context of this journey's own, with what the person wrote in it and what two Connections
 * made there, the second ended since, and a Connection of another Context, which is not offered.
 */
async function contextWithAuthors(page: Page, testInfo: TestInfo) {
  const tag = `${testInfo.project.name}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const context = await contextOfOwn(page, testInfo, "Authors");
  const elsewhere = await contextOfOwn(page, testInfo, "Elsewhere");
  const call = (tool: string, input: unknown) => callContextTool(page, context.id, tool, input);
  const garden = (await call("create_project", { name: `Garden ${tag}` })).record;
  const connection = async (name: string, context_id = context.id) =>
    (await callDeploymentTool(page, "create_connection", { name, context_id, reading_only: false }))
      .record;
  const scribe = await connection(`Scribe ${tag}`);
  const helper = await connection(`Helper ${tag}`);
  await connection(`Stranger ${tag}`, elsewhere.id);

  await page.goto("/");
  /** What a Connection's call wrote, as its outside agent is answered. */
  const made = async (client: Client, name: string, args: Record<string, unknown>) => {
    const answer = (await client.callTool({ name, arguments: args })).structuredContent as {
      value: { record: { id: string } };
    };
    return answer.value.record;
  };
  const write = (client: Client, words: string) => made(client, "record_entry", { words });
  await call("record_entry", { words: `Pruned the roses ${tag}` });
  const byScribe = await connectTo(new URL(scribe.address, page.url()).href);
  await write(byScribe, `Planting plan ${tag}`);
  const byHelper = await connectTo(new URL(helper.address, page.url()).href);
  await write(byHelper, `Watering rota ${tag}`);
  const noted = await write(byScribe, `Seed order ${tag}`);
  const task = await made(byScribe, "add_task", {
    entry_id: noted.id,
    title: `Order the seeds ${tag}`,
  });
  await call("move_task", { id: task.id, project_id: garden.id });
  await callDeploymentTool(page, "end_connection", { id: helper.id });
  return { tag, scribe: scribe.name, helper: helper.name, garden: garden.name };
}

async function openSearch(page: Page, testInfo: TestInfo) {
  await page.goto("/");
  const { journal } = await openJournal(page, testInfo);
  const field = await enterSearch(page);
  const chips = journal.getByRole("group", { name: "Narrow the search" });
  const found = journal.getByRole("region", { name: "Found" });
  return { journal, field, chips, found, excerpts: found.getByTestId("search-excerpt") };
}

test("the Author chip offers you, the Agent, any Connection and each of the Context's by name, an ended one too, and lists what each made newest first", async ({
  page,
}, testInfo) => {
  const { tag, scribe, helper, garden } = await contextWithAuthors(page, testInfo);
  const { journal, field, chips, found, excerpts } = await openSearch(page, testInfo);
  const authorChip = chips.getByRole("button", { name: "Author", exact: true });
  const picker = journal.getByRole("dialog", { name: "Author" });
  const pick = async (choice: string) => {
    await authorChip.click();
    await picker.getByRole("button", { name: choice, exact: true }).click();
    await expect(picker).toHaveCount(0);
  };

  // The Connections offered are this Context's alone, in the order they were made, the ended one
  // marked so.
  await authorChip.click();
  await expect(picker.getByRole("button")).toHaveText([
    "You",
    "The Agent",
    "Any Connection",
    scribe,
    `${helper} · Ended`,
  ]);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(authorChip).toBeFocused();

  // A Connection by name: everything it made, newest first, with no words.
  await pick(scribe);
  const scribeChip = chips.getByRole("button", { name: `Author: ${scribe}, remove` });
  await expect(scribeChip).toHaveText(`By ${scribe}`);
  await expect(scribeChip).toBeFocused();
  await expect(found.getByRole("status")).toHaveText(`Everything by ${scribe}, newest first`);
  await expect(excerpts).toHaveText([
    `Order the seeds ${tag}`,
    `Seed order ${tag}`,
    `Planting plan ${tag}`,
  ]);

  // With words, it narrows what they find.
  await field.fill("planting");
  await expect(excerpts).toHaveText([`Planting plan ${tag}`]);

  // What the person wrote is not found by it, and Nothing found offers to lift it.
  await field.fill(`roses ${tag}`);
  await expect(found.getByText(`Only what ${scribe} made is searched.`)).toBeVisible();
  await found.getByRole("button", { name: "Search every Author" }).click();
  await expect(excerpts).toHaveText([`Pruned the roses ${tag}`]);
  await field.fill("");
  await pick(scribe);

  // With a Project chip, it narrows to what that Author made in that Project.
  await chips.getByRole("button", { name: "Project", exact: true }).click();
  const projects = journal.getByRole("dialog", { name: "Project" });
  await projects.getByRole("combobox", { name: "Find a Project" }).fill(tag);
  await projects.getByRole("option", { name: garden }).click();
  await expect(found.getByRole("status")).toHaveText(
    `Everything in ${garden} by ${scribe}, newest first`,
  );
  await expect(excerpts).toHaveText([`Order the seeds ${tag}`, `Seed order ${tag}`]);
  await chips.getByRole("button", { name: `Project: ${garden}, remove` }).click();
  await scribeChip.click();

  // An ended Connection by name: what it made before it ended.
  await pick(`${helper} · Ended`);
  await expect(chips.getByRole("button", { name: `Author: ${helper}, remove` })).toHaveText(
    `By ${helper}`,
  );
  await expect(excerpts).toHaveText([`Watering rota ${tag}`]);
  await chips.getByRole("button", { name: `Author: ${helper}, remove` }).click();

  // Any Connection: what every Connection made, ended or not, and nothing the person wrote.
  await pick("Any Connection");
  await expect(chips.getByRole("button", { name: "Author: any Connection, remove" })).toHaveText(
    "By any Connection",
  );
  await expect(found.getByRole("status")).toHaveText("Everything by any Connection, newest first");
  await expect(excerpts).toHaveText([
    `Order the seeds ${tag}`,
    `Seed order ${tag}`,
    `Watering rota ${tag}`,
    `Planting plan ${tag}`,
  ]);
  await chips.getByRole("button", { name: "Author: any Connection, remove" }).click();

  // You: what the person wrote.
  await pick("You");
  await expect(found.getByRole("status")).toHaveText("Everything by you, newest first");
  await expect(excerpts).toHaveText([`Pruned the roses ${tag}`]);
  await chips.getByRole("button", { name: "Author: you, remove" }).click();

  // Left open, so the accessibility check sees the picker and its choices.
  await authorChip.click();
  await expect(picker.getByRole("button")).toHaveCount(5);
});
