import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  callContextTool,
  callDeploymentTool,
  expect,
  holdNext,
  lastShown,
  makeContext,
  openSettings,
  test,
} from "./fixtures.ts";

// The Changes (section 8.6): what changed in a Context and who changed it, narrowed by caller,
// with what an outside agent read listed alongside (section 7.3). A Context of the journey's own,
// so its change log is its own.

/** An outside agent with a Connection's address pasted into it, signed in as the person. */
async function connectTo(address: string): Promise<Client> {
  const client = new Client(
    { name: "a browser journey", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(address)));
  return client;
}

test("the person sees what changed and who changed it, with a Connection's reads alongside, and narrows it to one caller", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await makeContext(page, {
    name: `Changes ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  const mine = `Called the plumber ${tag}`;
  await callContextTool(page, id, "record_entry", { words: mine });
  const agentName = `Claude ${tag}`;
  const { record: connection } = await callDeploymentTool(page, "create_connection", {
    name: agentName,
    context_id: id,
    reading_only: false,
  });
  await page.goto("/");
  const agent = await connectTo(new URL(connection.address, page.url()).href);
  const theirs = `Noted from elsewhere ${tag}`;
  await agent.callTool({ name: "list_entries", arguments: {} });
  await agent.callTool({ name: "record_entry", arguments: { words: theirs } });

  const changes = await openSettings(page, "Changes");
  const list = changes.getByRole("list", { name: "Changes and reads" });

  // Newest first: the Connection's Entry, its read before it, then the person's own.
  const lines = list.getByTestId(/^(change|connection-read)$/);
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText(agentName);
  await expect(lines.nth(0)).toContainText(`Entry made ${theirs}`);
  await expect(lines.nth(1)).toContainText(agentName);
  await expect(lines.nth(1)).toContainText("Listed Entries: 1 record");
  await expect(lines.nth(2)).toContainText("You");
  await expect(lines.nth(2)).toContainText(`Entry made ${mine}`);
  // What the agent read holds none of what it was given.
  await expect(changes.getByTestId("connection-read")).not.toContainText(mine);

  const madeBy = changes.getByRole("combobox", { name: "Made by" });
  await madeBy.selectOption({ label: "You" });
  await expect(list.getByTestId("change")).toHaveCount(1);
  await expect(list.getByTestId("change")).toContainText(mine);
  await expect(list.getByTestId("connection-read")).toHaveCount(0);

  await madeBy.selectOption({ label: agentName });
  await expect(list.getByTestId("change")).toHaveCount(1);
  await expect(list.getByTestId("change")).toContainText(theirs);
  await expect(list.getByTestId("connection-read")).toHaveCount(1);

  // A change made meanwhile comes over the live channel, if it is the caller's narrowed to: the
  // person's own, which comes first, is left out once the agent's after it shows.
  await callContextTool(page, id, "record_entry", { words: `Mine again ${tag}` });
  const later = `Later from elsewhere ${tag}`;
  await agent.callTool({ name: "record_entry", arguments: { words: later } });
  await expect(list.getByTestId("change").first()).toContainText(later);
  await expect(list.getByTestId("change")).toHaveCount(2);

  // A change that lands while the list is being read is shown once the read is in, and once: the
  // answer from before it is dropped, and the list read again.
  const reading = new RegExp(`/api/contexts/${id}/tools/list_changes$`);
  const held = await holdNext(page, reading);
  await madeBy.selectOption({ label: "Anyone" });
  await held.asked();
  const readAgain = page.waitForRequest(reading);
  const during = `Meanwhile from elsewhere ${tag}`;
  await agent.callTool({ name: "record_entry", arguments: { words: during } });
  await readAgain;
  await held.release();
  await expect(list.getByTestId("change").filter({ hasText: during })).toHaveCount(1);
  await expect(list.getByTestId("change")).toHaveCount(5);
});

test("the person sees what a delete and a restore did in words, with what a rule did folded", async ({
  page,
}, testInfo) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const { id } = await makeContext(page, {
    name: `Changes folded ${testInfo.project.name} ${tag}`,
    time_zone: "UTC",
    accent: "teal",
  });
  await lastShown(page, id);
  const words = `Plan the move ${tag}`;
  const titles = [`Book the van ${tag}`, `Pack the books ${tag}`];
  const { record } = await callContextTool(page, id, "record_entry", {
    words,
    tasks: titles.map((title) => ({ title })),
  });
  await callContextTool(page, id, "delete_entry", { id: record.id });
  await callContextTool(page, id, "restore", { id: record.id });
  await page.goto("/");

  const changes = await openSettings(page, "Changes");
  const list = changes.getByRole("list", { name: "Changes and reads" });
  const lines = list.getByTestId("change");
  await expect(lines).toHaveCount(3);
  const [restored, deleted] = [lines.nth(0), lines.nth(1)];
  await expect(restored).toContainText(`Entry restored from the Trash ${words}`);
  await expect(restored).toContainText("and 2 Tasks restored from the Trash by a rule");
  await expect(deleted).toContainText(`Entry sent to the Trash ${words}`);

  // What the rule did is one line, which opens in place to list each Task it sent.
  const fold = deleted.getByText("and 2 Tasks sent to the Trash by a rule");
  for (const title of titles) await expect(deleted.getByText(title)).toBeHidden();
  await fold.click();
  for (const title of titles) await expect(deleted.getByText(title)).toBeVisible();
});
